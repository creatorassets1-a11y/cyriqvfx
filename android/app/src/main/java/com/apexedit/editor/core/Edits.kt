package com.apexedit.editor.core

/**
 * Editing operations.
 *
 * Every function takes a document and returns a new one. None of them throw:
 * an impossible edit (locked track, trim past the end of the media, a cut on a
 * clip edge) returns the document unchanged. A dropped gesture must never break
 * a session, and a pan handler should not have to catch exceptions.
 *
 * The semantics here match the TypeScript engine in `packages/edit-engine`,
 * whose 183 tests are the conformance suite for this port.
 */

// ---------------------------------------------------------------------------
// Index maintenance — the only place documents are constructed
// ---------------------------------------------------------------------------

private fun EditDocument.withClip(clip: Clip): EditDocument {
    val existing = clips[clip.id]
    val newClips = clips + (clip.id to clip)
    if (existing != null && existing.trackId == clip.trackId && existing.start == clip.start) {
        return copy(clips = newClips)
    }
    val index = trackClips.toMutableMap()
    if (existing != null && existing.trackId != clip.trackId) {
        index[existing.trackId] = index[existing.trackId].orEmpty().filterNot { it == clip.id }
    }
    val target = (index[clip.trackId].orEmpty().filterNot { it == clip.id } + clip.id)
        .sortedBy { newClips[it]?.start ?: 0L }
    index[clip.trackId] = target
    return copy(clips = newClips, trackClips = index)
}

private fun EditDocument.withoutClip(clipId: Id): EditDocument {
    val clip = clips[clipId] ?: return this
    return copy(
        clips = clips - clipId,
        trackClips = trackClips + (clip.trackId to trackClips[clip.trackId].orEmpty().filterNot { it == clipId }),
    )
}

fun EditDocument.updateClip(clipId: Id, block: (Clip) -> Clip): EditDocument {
    val clip = clips[clipId] ?: return this
    return withClip(block(clip))
}

fun EditDocument.updateTrack(trackId: Id, block: (Track) -> Track): EditDocument =
    copy(tracks = tracks.map { if (it.id == trackId) block(it) else it })

fun EditDocument.addMedia(asset: MediaAsset): EditDocument = copy(media = media + (asset.id to asset))

private fun EditDocument.isLocked(trackId: Id): Boolean = track(trackId)?.locked == true

/** Rebuild the derived index — used after loading a project. */
fun EditDocument.reindex(): EditDocument {
    val index = tracks.associate { t ->
        t.id to clips.values.filter { it.trackId == t.id }.sortedBy { it.start }.map { it.id }
    }
    return copy(trackClips = index)
}

// ---------------------------------------------------------------------------
// Media limits
// ---------------------------------------------------------------------------

/** Source available before the clip's in point. Infinite for generated content. */
fun EditDocument.headroom(clip: Clip): Long =
    if (isMediaLimited(clip)) clip.mediaIn else Long.MAX_VALUE / 4

/** Source available after the clip's out point. */
fun EditDocument.tailroom(clip: Clip): Long {
    if (!isMediaLimited(clip)) return Long.MAX_VALUE / 4
    val total = mediaFor(clip)?.duration ?: return Long.MAX_VALUE / 4
    return (total - (clip.mediaIn + clip.sourceSpan)).coerceAtLeast(0)
}

private fun EditDocument.isMediaLimited(clip: Clip): Boolean {
    val asset = mediaFor(clip) ?: return false
    return asset.duration != null && asset.kind != MediaKind.IMAGE
}

fun minClipDuration(rate: FrameRate): Long = rate.ticksPerFrame

// ---------------------------------------------------------------------------
// Trim
// ---------------------------------------------------------------------------

/**
 * Move a clip's head, consuming or releasing source. The tail stays put.
 * Clamped by available source and by a one-frame minimum.
 */
fun EditDocument.setClipHead(clip: Clip, newStart: Long): Clip {
    val rate = settings.frameRate
    val min = minClipDuration(rate)
    val earliest = clip.start - headroom(clip)
    val latest = clip.end - min
    val target = newStart.coerceIn(earliest, latest).roundToFrame(rate)

    val delta = target - clip.start
    if (delta == 0L) return clip
    // Source consumed scales with speed: trimming 10 frames off a 2x clip
    // advances the media in point by 20 frames.
    val sourceDelta = (delta * clip.speed).toLong()
    return clip.copy(
        start = target,
        duration = clip.duration - delta,
        mediaIn = (clip.mediaIn + sourceDelta).coerceAtLeast(0),
    )
}

/** Move a clip's tail. The head stays put. */
fun EditDocument.setClipTail(clip: Clip, newEnd: Long): Clip {
    val rate = settings.frameRate
    val min = minClipDuration(rate)
    val latest = clip.end + tailroom(clip)
    val earliest = clip.start + min
    val target = newEnd.coerceIn(earliest, latest).roundToFrame(rate)
    val duration = target - clip.start
    return if (duration == clip.duration) clip else clip.copy(duration = duration)
}

fun EditDocument.trimStart(clipId: Id, newStart: Long, ripple: Boolean = false): EditDocument {
    val clip = clips[clipId] ?: return this
    if (isLocked(clip.trackId)) return this

    val limited = if (ripple) newStart else maxOf(newStart, previousOf(clipId)?.end ?: Long.MIN_VALUE / 4)
    val trimmed = setClipHead(clip, limited)
    val delta = trimmed.start - clip.start
    if (delta == 0L) return this

    var out = withClip(trimmed)
    if (ripple) {
        out = out.updateClip(clipId) { it.copy(start = clip.start) }
        out = out.shiftAfter(clip.trackId, clip.start, -delta, exclude = clipId)
    }
    return out.applyToLinked(this, clipId) { setClipHead(it, limited) }
}

fun EditDocument.trimEnd(clipId: Id, newEnd: Long, ripple: Boolean = false): EditDocument {
    val clip = clips[clipId] ?: return this
    if (isLocked(clip.trackId)) return this

    val limited = if (ripple) newEnd else minOf(newEnd, nextOf(clipId)?.start ?: Long.MAX_VALUE / 4)
    val trimmed = setClipTail(clip, limited)
    val delta = trimmed.duration - clip.duration
    if (delta == 0L) return this

    var out = withClip(trimmed)
    if (ripple) out = out.shiftAfter(clip.trackId, clip.end, delta, exclude = clipId)
    return out.applyToLinked(this, clipId) { setClipTail(it, limited) }
}

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

/**
 * Split a clip in two. Both halves keep the full grade and effect stack — a
 * split is a cut, not a simplification — and the second half's media in point
 * advances by exactly what the first half consumed.
 */
fun EditDocument.splitClip(clipId: Id, time: Long): EditDocument {
    val clip = clips[clipId] ?: return this
    if (isLocked(clip.trackId)) return this

    val rate = settings.frameRate
    val at = time.roundToFrame(rate)
    val min = minClipDuration(rate)
    if (at <= clip.start + min - 1 || at >= clip.end - min + 1) return this

    val left = setClipTail(clip, at)
    val right = setClipHead(clip, at).copy(
        id = newId("clip"),
        // A transition belongs to the cut it was authored on, not the new one.
        transitionIn = null,
    )
    return withClip(left).withClip(right)
}

/** Split every clip crossing [time] on the given tracks, or on all of them. */
fun EditDocument.splitAt(time: Long, trackIds: List<Id>? = null): EditDocument {
    var out = this
    for (trackId in trackIds ?: tracks.map { it.id }) {
        if (isLocked(trackId)) continue
        val clip = out.clipsOn(trackId).firstOrNull { time > it.start && time < it.end }
        if (clip != null) out = out.splitClip(clip.id, time)
    }
    return out
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Remove clips, leaving gaps. */
fun EditDocument.liftClips(clipIds: List<Id>): EditDocument {
    var out = this
    for (id in expandToLinked(clipIds)) {
        val clip = out.clips[id] ?: continue
        if (isLocked(clip.trackId)) continue
        out = out.withoutClip(id)
    }
    return out
}

/**
 * Remove clips and close the gap behind them.
 *
 * Only the tracks the deleted clips were on shift. Rippling every track would
 * silently destroy sync with overlays the user never selected.
 */
fun EditDocument.rippleDelete(clipIds: List<Id>): EditDocument {
    val ids = expandToLinked(clipIds).filter { clips[it] != null && !isLocked(clips[it]!!.trackId) }
    if (ids.isEmpty()) return this

    var out = this
    // Process each track's removals from the end backwards, so earlier shifts
    // never invalidate later positions.
    ids.mapNotNull { clips[it] }
        .groupBy { it.trackId }
        .forEach { (trackId, group) ->
            group.sortedByDescending { it.start }.forEach { clip ->
                out = out.withoutClip(clip.id).shiftAfter(trackId, clip.start, -clip.duration)
            }
        }
    return out
}

/** Close every gap on a track, packing clips flush from the first. */
fun EditDocument.closeGaps(trackId: Id): EditDocument {
    if (isLocked(trackId)) return this
    var out = this
    var cursor = clipsOn(trackId).firstOrNull()?.start ?: 0L
    for (clip in clipsOn(trackId)) {
        if (clip.start != cursor) out = out.updateClip(clip.id) { it.copy(start = cursor) }
        cursor += clip.duration
    }
    return out
}

// ---------------------------------------------------------------------------
// Roll, slip, slide
// ---------------------------------------------------------------------------

/** Move the cut between a clip and the next. Total length is unchanged. */
fun EditDocument.rollEdit(clipId: Id, newCut: Long): EditDocument {
    val clip = clips[clipId] ?: return this
    if (isLocked(clip.trackId)) return this
    val next = nextOf(clipId) ?: return this
    // Roll is only defined across a hard cut.
    if (next.start != clip.end) return this

    val left = setClipTail(clip, newCut)
    val cut = left.end
    val right = setClipHead(next, cut)
    // Only commit when both sides reached the same cut, or a gap would open.
    if (right.start != cut) return this
    return withClip(left).withClip(right)
}

/** Change which part of the source plays, without moving the clip. */
fun EditDocument.slipClip(clipId: Id, delta: Long): EditDocument {
    val clip = clips[clipId] ?: return this
    if (isLocked(clip.trackId)) return this
    val applied = delta.coerceIn(-headroom(clip), tailroom(clip))
    if (applied == 0L) return this
    return updateClip(clipId) { it.copy(mediaIn = (it.mediaIn + applied).coerceAtLeast(0)) }
}

/** Move a clip within its neighbours; they absorb the change. */
fun EditDocument.slideClip(clipId: Id, delta: Long): EditDocument {
    val clip = clips[clipId] ?: return this
    if (isLocked(clip.trackId)) return this
    val rate = settings.frameRate
    val min = minClipDuration(rate)
    val previous = previousOf(clipId)
    val next = nextOf(clipId)

    var lower = Long.MIN_VALUE / 4
    var upper = Long.MAX_VALUE / 4
    if (previous != null && previous.end == clip.start) lower = previous.start + min - clip.start
    if (next != null && next.start == clip.end) upper = next.end - min - clip.end

    val applied = delta.coerceIn(lower, upper).roundToFrame(rate)
    if (applied == 0L) return this

    var out = updateClip(clipId) { it.copy(start = it.start + applied) }
    if (previous != null && previous.end == clip.start) {
        out = out.withClip(out.setClipTail(previous, clip.start + applied))
    }
    if (next != null && next.start == clip.end) {
        out = out.withClip(out.setClipHead(next, clip.end + applied))
    }
    return out
}

// ---------------------------------------------------------------------------
// Move, insert, overwrite
// ---------------------------------------------------------------------------

enum class CollisionPolicy { OVERWRITE, RIPPLE, REJECT }

fun EditDocument.moveClip(
    clipId: Id,
    targetTrackId: Id? = null,
    newStart: Long? = null,
    policy: CollisionPolicy = CollisionPolicy.OVERWRITE,
): EditDocument {
    val clip = clips[clipId] ?: return this
    val trackId = targetTrackId ?: clip.trackId
    val target = track(trackId) ?: return this
    if (target.locked || isLocked(clip.trackId)) return this
    if (!trackAccepts(target, clip)) return this

    val rate = settings.frameRate
    val start = (newStart ?: clip.start).coerceAtLeast(0).roundToFrame(rate)
    if (start == clip.start && trackId == clip.trackId) return this

    val moved = clip.copy(trackId = trackId, start = start)
    val range = TimeRange(start, clip.duration)
    var out = withoutClip(clipId)

    when (policy) {
        CollisionPolicy.REJECT ->
            if (out.clipsOn(trackId).any { it.range.overlaps(range) }) return this
        CollisionPolicy.RIPPLE -> out = out.openSpace(trackId, range)
        CollisionPolicy.OVERWRITE -> out = out.clearRange(trackId, range)
    }
    return out.withClip(moved)
}

/** Place a clip over what is already there, trimming or splitting it. */
fun EditDocument.overwriteClip(clip: Clip): EditDocument {
    val target = track(clip.trackId) ?: return this
    if (target.locked || !trackAccepts(target, clip)) return this
    return clearRange(clip.trackId, clip.range).withClip(clip)
}

/** Append flush to the end of a track — what "add to timeline" does. */
fun EditDocument.appendClip(clip: Clip): EditDocument {
    val start = clipsOn(clip.trackId).lastOrNull()?.end ?: 0L
    return overwriteClip(clip.copy(start = start))
}

/** Insert, pushing later clips back to make room. */
fun EditDocument.insertClip(clip: Clip): EditDocument {
    val target = track(clip.trackId) ?: return this
    if (target.locked || !trackAccepts(target, clip)) return this
    return openSpace(clip.trackId, clip.range).withClip(clip)
}

/**
 * Clear a range on a track: remove clips inside it, trim partial overlaps, and
 * split anything that straddles it.
 */
fun EditDocument.clearRange(trackId: Id, range: TimeRange, except: Id? = null): EditDocument {
    var out = this
    for (clip in clipsOn(trackId)) {
        if (clip.id == except || !clip.range.overlaps(range)) continue
        val startsBefore = clip.start < range.start
        val endsAfter = clip.end > range.end

        out = when {
            startsBefore && endsAfter -> {
                val head = out.setClipTail(clip, range.start)
                val tail = out.setClipHead(clip, range.end).copy(id = newId("clip"), transitionIn = null)
                out.withClip(head).withClip(tail)
            }
            startsBefore -> out.withClip(out.setClipTail(clip, range.start))
            endsAfter -> out.withClip(out.setClipHead(clip, range.end))
            else -> out.withoutClip(clip.id)
        }
    }
    return out
}

/** Delete a range across tracks, optionally closing the hole. */
fun EditDocument.deleteRange(range: TimeRange, trackIds: List<Id>? = null, ripple: Boolean = false): EditDocument {
    var out = this
    for (trackId in (trackIds ?: tracks.map { it.id }).filterNot { isLocked(it) }) {
        out = out.clearRange(trackId, range)
        if (ripple) out = out.shiftAfter(trackId, range.start, -range.duration)
    }
    return out
}

private fun EditDocument.openSpace(trackId: Id, range: TimeRange): EditDocument {
    val blocking = clipsOn(trackId).filter { it.end > range.start && it.range.overlaps(range) }
    if (blocking.isEmpty()) return this
    val from = minOf(range.start, blocking.minOf { it.start })
    return shiftAfter(trackId, from, range.duration)
}

/** Move every clip starting at or after [from] by [delta]. */
fun EditDocument.shiftAfter(trackId: Id, from: Long, delta: Long, exclude: Id? = null): EditDocument {
    if (delta == 0L) return this
    var out = this
    for (clip in clipsOn(trackId)) {
        if (clip.id == exclude || clip.start < from) continue
        out = out.updateClip(clip.id) { it.copy(start = (it.start + delta).coerceAtLeast(0)) }
    }
    return out
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

const val MIN_SPEED = 0.1f
const val MAX_SPEED = 100f

/**
 * Change a clip's speed.
 *
 * The clip keeps showing the same footage, so it grows when slowed and shrinks
 * when sped up — which is what the speed dial should do. Clamped to whatever
 * source actually exists.
 */
fun EditDocument.setClipSpeed(clipId: Id, speed: Float): EditDocument {
    val clip = clips[clipId] ?: return this
    if (isLocked(clip.trackId)) return this
    val rate = settings.frameRate
    val clamped = speed.coerceIn(MIN_SPEED, MAX_SPEED)
    if (clamped == clip.speed) return this

    val sourceSpan = clip.sourceSpan
    val available = mediaFor(clip)?.duration?.let { it - clip.mediaIn } ?: Long.MAX_VALUE / 4
    val usable = minOf(sourceSpan, available)
    val newDuration = (usable / clamped).toLong()
        .roundToFrame(rate)
        .coerceAtLeast(minClipDuration(rate))

    return updateClip(clipId) { it.copy(speed = clamped, duration = newDuration) }
}

fun EditDocument.reverseClip(clipId: Id): EditDocument =
    updateClip(clipId) { it.copy(reversed = !it.reversed) }

// ---------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------

fun EditDocument.linkClips(clipIds: List<Id>): EditDocument {
    if (clipIds.size < 2) return this
    val group = newId("grp")
    var out = this
    for (id in clipIds) out = out.updateClip(id) { it.copy(linkGroup = group) }
    return out
}

fun EditDocument.unlinkClips(clipIds: List<Id>): EditDocument {
    var out = this
    for (id in clipIds) out = out.updateClip(id) { it.copy(linkGroup = null) }
    return out
}

/** Detach a clip's audio onto an audio track, keeping the two in sync. */
fun EditDocument.detachAudio(clipId: Id, audioTrackId: Id): EditDocument {
    val clip = clips[clipId] ?: return this
    val target = track(audioTrackId) ?: return this
    if (target.kind != TrackKind.AUDIO) return this
    if (mediaFor(clip)?.hasAudio != true) return this

    val group = clip.linkGroup ?: newId("grp")
    val audioClip = clip.copy(
        id = newId("clip"),
        trackId = audioTrackId,
        linkGroup = group,
        grade = Grade.NEUTRAL,
        transform = Transform(),
        transitionIn = null,
    )
    return updateClip(clipId) { it.copy(audio = it.audio.copy(muted = true), linkGroup = group) }
        .overwriteClip(audioClip)
}

fun EditDocument.linkedClips(clipId: Id): List<Clip> {
    val clip = clips[clipId] ?: return emptyList()
    val group = clip.linkGroup ?: return listOf(clip)
    return clips.values.filter { it.linkGroup == group }
}

private fun EditDocument.expandToLinked(ids: List<Id>): List<Id> =
    ids.flatMap { linkedClips(it).map(Clip::id) }.distinct()

private fun EditDocument.applyToLinked(
    original: EditDocument,
    clipId: Id,
    mutate: EditDocument.(Clip) -> Clip,
): EditDocument {
    val clip = original.clips[clipId] ?: return this
    if (clip.linkGroup == null) return this
    var out = this
    for (linked in original.linkedClips(clipId)) {
        if (linked.id == clipId || original.isLocked(linked.trackId)) continue
        out = out.withClip(original.mutate(linked))
    }
    return out
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Apply a transition on the cut before a clip. Its duration is clamped to the
 * shorter of the two clips, since a dissolve needs media on both sides.
 */
fun EditDocument.setTransition(clipId: Id, type: TransitionType, duration: Long): EditDocument {
    val clip = clips[clipId] ?: return this
    val previous = previousOf(clipId) ?: return this
    if (previous.end != clip.start) return this
    if (type == TransitionType.NONE) return updateClip(clipId) { it.copy(transitionIn = null) }

    val max = minOf(clip.duration, previous.duration)
    val clamped = duration.coerceIn(0, max).roundToFrame(settings.frameRate)
    if (clamped <= 0) return updateClip(clipId) { it.copy(transitionIn = null) }
    return updateClip(clipId) { it.copy(transitionIn = Transition(type, clamped)) }
}

// ---------------------------------------------------------------------------
// Neighbours and snapping
// ---------------------------------------------------------------------------

fun EditDocument.previousOf(clipId: Id): Clip? {
    val clip = clips[clipId] ?: return null
    val ids = trackClips[clip.trackId].orEmpty()
    val i = ids.indexOf(clipId)
    return if (i > 0) clips[ids[i - 1]] else null
}

fun EditDocument.nextOf(clipId: Id): Clip? {
    val clip = clips[clipId] ?: return null
    val ids = trackClips[clip.trackId].orEmpty()
    val i = ids.indexOf(clipId)
    return if (i >= 0 && i < ids.size - 1) clips[ids[i + 1]] else null
}

/** Cut points the playhead snaps to and "next edit" navigation jumps between. */
fun EditDocument.editPoints(): List<Long> {
    val points = sortedSetOf(0L)
    for (clip in clips.values) {
        points.add(clip.start)
        points.add(clip.end)
    }
    return points.toList()
}

/** Nearest edit point within [tolerance], or null. */
fun EditDocument.snapTarget(time: Long, tolerance: Long, exclude: Set<Id> = emptySet()): Long? {
    var best: Long? = null
    var bestDistance = tolerance + 1

    fun consider(candidate: Long) {
        val d = kotlin.math.abs(candidate - time)
        if (d <= tolerance && d < bestDistance) {
            best = candidate
            bestDistance = d
        }
    }

    consider(0L)
    for (clip in clips.values) {
        if (clip.id in exclude) continue
        consider(clip.start)
        consider(clip.end)
    }
    return best
}

private fun trackAccepts(track: Track, clip: Clip): Boolean =
    track.kind == TrackKind.VIDEO || clip.content is ClipContent.Media

package com.apexedits.core.engine.edit

import com.apexedits.core.model.Clip
import com.apexedits.core.model.ColorTag
import com.apexedits.core.model.IdSource
import com.apexedits.core.model.Marker
import com.apexedits.core.model.MediaRef
import com.apexedits.core.model.Project
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.Track
import com.apexedits.core.model.TrackKind

/**
 * Editing operations.
 *
 * **Every operation clamps; none throws.** A trim past the end of the media
 * stops at the media. A move onto a locked track is a no-op that returns the
 * document unchanged. A split at a point where no clip exists changes nothing.
 *
 * This is a deliberate contract, not defensive coding. These functions are
 * driven by touch gestures, and a gesture can be dropped, doubled, or arrive
 * with a stale position when a finger leaves the screen mid-drag. If the engine
 * threw on a nonsensical input, every gesture handler would need to guard
 * against states it cannot actually observe, and the one that forgot would take
 * the user's session with it. Returning the document unchanged makes a bad
 * gesture a no-op instead of a crash.
 */

/** Smallest clip an edit will leave behind: one frame at 60 fps. */
val MIN_CLIP_DURATION: Ticks = Ticks(11_760_000)

// --- internal plumbing -------------------------------------------------------

private fun Project.replaceTrack(trackId: String, transform: (Track) -> Track): Project {
    val index = tracks.indexOfFirst { it.id == trackId }
    if (index < 0) return this
    val updated = transform(tracks[index])
    if (updated == tracks[index]) return this
    return copy(
        tracks = tracks.toMutableList().also { it[index] = updated },
        revision = revision + 1,
    )
}

private fun Track.replaceClip(clipId: String, transform: (Clip) -> Clip?): Track {
    val index = clips.indexOfFirst { it.id == clipId }
    if (index < 0) return this
    val updated = transform(clips[index])
    val next = clips.toMutableList()
    if (updated == null) next.removeAt(index) else next[index] = updated
    return copy(clips = next)
}

/** The track holding [clipId], or null. Locked tracks are reported normally; callers check. */
private fun Project.editableTrackOf(clipId: String): Track? =
    trackOf(clipId)?.takeIf { !it.locked }

// --- split -------------------------------------------------------------------

/**
 * Splits the clip under [at] on [trackId] into two clips.
 *
 * The right half becomes a new clip whose source window starts where the left
 * half's ends, so the two play back seamlessly. No-op when [at] falls on a
 * boundary or outside every clip, or when either half would fall below
 * [MIN_CLIP_DURATION].
 */
fun Project.splitClip(ids: IdSource, trackId: String, at: Ticks): Project {
    val track = track(trackId) ?: return this
    if (track.locked) return this
    val clip = track.clipAt(at) ?: return this

    val leftDuration = at - clip.timelineStart
    val rightDuration = clip.timelineEnd - at
    if (leftDuration < MIN_CLIP_DURATION || rightDuration < MIN_CLIP_DURATION) return this

    // Convert the timeline split point into the source, so a retimed clip
    // splits at the frame the user actually sees.
    val sourceSplit = clip.sourceTimeAt(at)

    val left = clip.copy(sourceOut = sourceSplit)
    val right = clip.copy(
        id = ids.next("clip"),
        timelineStart = at,
        sourceIn = sourceSplit,
        // A split breaks the audio/video link: the halves are separate clips.
        linkedClipId = null,
    )

    return replaceTrack(trackId) { t ->
        t.copy(clips = t.clips.map { if (it.id == clip.id) left else it } + right)
    }
}

/** Splits every unlocked track that has a clip under [at]. The toolbar's Split button. */
fun Project.splitAllTracksAt(ids: IdSource, at: Ticks): Project =
    tracks.map { it.id }.fold(this) { project, trackId -> project.splitClip(ids, trackId, at) }

// --- trim --------------------------------------------------------------------

enum class TrimEdge { START, END }

/**
 * Moves one edge of a clip to [to] on the timeline.
 *
 * Clamped by three things, in this order: the media has to have frames there,
 * the clip cannot shrink below [MIN_CLIP_DURATION], and the clip cannot cross
 * its neighbour. Dragging further than any of those allow stops at the limit
 * rather than refusing the gesture — the edge follows the finger until it
 * physically cannot, which is what makes trimming feel direct.
 *
 * With [ripple] set, later clips on the same track shift by the same amount so
 * no gap opens.
 */
fun Project.trimClip(
    clipId: String,
    edge: TrimEdge,
    to: Ticks,
    ripple: Boolean = false,
): Project {
    val track = editableTrackOf(clipId) ?: return this
    val clip = track.clips.firstOrNull { it.id == clipId } ?: return this
    val media = mediaRef(clip.mediaId)

    val ordered = track.ordered
    val index = ordered.indexOfFirst { it.id == clipId }
    val previous = ordered.getOrNull(index - 1)
    val next = ordered.getOrNull(index + 1)

    return when (edge) {
        TrimEdge.START -> {
            // How far back the source can go before running out of media.
            val headroom = clip.sourceIn
            var lowerBound = clip.timelineStart - headroom
            // In freeform mode the previous clip blocks the edge; in magnetic
            // mode a ripple trim is allowed to move into the space it vacates.
            if (previous != null && !(ripple && track.magnetic)) {
                lowerBound = lowerBound.coerceAtLeast(previous.timelineEnd)
            }
            val upperBound = clip.timelineEnd - MIN_CLIP_DURATION
            val target = to.coerceIn(lowerBound, upperBound.coerceAtLeast(lowerBound))

            val delta = target - clip.timelineStart
            val sourceDelta = if (clip.speed == 1f) delta else Ticks((delta.raw * clip.speed).toLong())
            val newSourceIn = (clip.sourceIn + sourceDelta).coerceIn(Ticks.ZERO, clip.sourceOut - MIN_CLIP_DURATION)

            replaceTrack(track.id) { t ->
                val trimmed = t.replaceClip(clipId) { c ->
                    c.copy(timelineStart = target, sourceIn = newSourceIn)
                }
                if (ripple) trimmed.shiftAfter(target, -delta, exceptId = clipId) else trimmed
            }
        }

        TrimEdge.END -> {
            val mediaDuration = media?.duration ?: clip.sourceOut
            val headroom = mediaDuration - clip.sourceOut
            var upperBound = clip.timelineEnd + headroom
            if (next != null && !(ripple && track.magnetic)) {
                upperBound = upperBound.coerceAtMost(next.timelineStart)
            }
            val lowerBound = clip.timelineStart + MIN_CLIP_DURATION
            val target = to.coerceIn(lowerBound.coerceAtMost(upperBound), upperBound)

            val delta = target - clip.timelineEnd
            val sourceDelta = if (clip.speed == 1f) delta else Ticks((delta.raw * clip.speed).toLong())
            val newSourceOut = (clip.sourceOut + sourceDelta)
                .coerceIn(clip.sourceIn + MIN_CLIP_DURATION, mediaDuration.coerceAtLeast(clip.sourceIn + MIN_CLIP_DURATION))

            replaceTrack(track.id) { t ->
                val trimmed = t.replaceClip(clipId) { c -> c.copy(sourceOut = newSourceOut) }
                if (ripple) trimmed.shiftAfter(clip.timelineEnd, delta, exceptId = clipId) else trimmed
            }
        }
    }
}

/** Shifts every clip starting at or after [from] by [delta]. Used by ripple edits. */
private fun Track.shiftAfter(from: Ticks, delta: Ticks, exceptId: String?): Track {
    if (delta.isZero) return this
    return copy(
        clips = clips.map { clip ->
            if (clip.id != exceptId && clip.timelineStart >= from) {
                clip.copy(timelineStart = (clip.timelineStart + delta).coerceAtLeast(Ticks.ZERO))
            } else {
                clip
            }
        },
    )
}

// --- delete ------------------------------------------------------------------

/** Removes a clip and leaves a gap where it was. */
fun Project.deleteClip(clipId: String): Project {
    val track = editableTrackOf(clipId) ?: return this
    return replaceTrack(track.id) { t -> t.replaceClip(clipId) { null } }
}

/**
 * Removes a clip and closes the gap: everything after it slides left by its
 * duration. The PRD's "ripple delete / close gap".
 */
fun Project.rippleDeleteClip(clipId: String): Project {
    val track = editableTrackOf(clipId) ?: return this
    val clip = track.clips.firstOrNull { it.id == clipId } ?: return this
    val duration = clip.timelineDuration
    return replaceTrack(track.id) { t ->
        t.replaceClip(clipId) { null }.shiftAfter(clip.timelineEnd, -duration, exceptId = null)
    }
}

/** Deletes several clips at once. Multi-select on the timeline. */
fun Project.deleteClips(clipIds: Collection<String>): Project =
    clipIds.fold(this) { project, id -> project.deleteClip(id) }

// --- move --------------------------------------------------------------------

/**
 * Moves a clip to [to], optionally onto [targetTrackId].
 *
 * A move onto a locked track, or between tracks of different kinds, is a no-op:
 * audio does not belong on a video track. Negative positions clamp to zero, so
 * dragging off the left edge parks the clip at the start instead of pushing it
 * into negative time.
 */
fun Project.moveClip(clipId: String, to: Ticks, targetTrackId: String? = null): Project {
    val sourceTrack = editableTrackOf(clipId) ?: return this
    val clip = sourceTrack.clips.firstOrNull { it.id == clipId } ?: return this
    val target = targetTrackId?.let { track(it) } ?: sourceTrack

    if (target.locked) return this
    if (target.kind != sourceTrack.kind) return this

    val start = to.coerceAtLeast(Ticks.ZERO)
    if (target.id == sourceTrack.id) {
        return replaceTrack(sourceTrack.id) { t ->
            t.replaceClip(clipId) { c -> c.copy(timelineStart = start) }
        }
    }

    val moved = clip.copy(timelineStart = start)
    return copy(
        tracks = tracks.map { t ->
            when (t.id) {
                sourceTrack.id -> t.copy(clips = t.clips.filterNot { it.id == clipId })
                target.id -> t.copy(clips = t.clips + moved)
                else -> t
            }
        },
        revision = revision + 1,
    )
}

// --- insert ------------------------------------------------------------------

/** Appends [clip] to the end of [trackId]. The "add at end" import option. */
fun Project.appendClip(trackId: String, clip: Clip): Project {
    val track = track(trackId) ?: return this
    if (track.locked) return this
    val end = track.clips.maxOfOrNull { it.timelineEnd.raw }?.let { Ticks(it) } ?: Ticks.ZERO
    return replaceTrack(trackId) { t -> t.copy(clips = t.clips + clip.copy(timelineStart = end)) }
}

/** Places [clip] at [at], overwriting whatever it lands on. The "at playhead" import option. */
fun Project.insertClipAt(trackId: String, clip: Clip, at: Ticks): Project {
    val track = track(trackId) ?: return this
    if (track.locked) return this
    val placed = clip.copy(timelineStart = at.coerceAtLeast(Ticks.ZERO))
    val kept = track.clips.filterNot { it.timelineStart >= placed.timelineStart && it.timelineEnd <= placed.timelineEnd }
    return replaceTrack(trackId) { t -> t.copy(clips = kept + placed) }
}

/** Duplicates a clip, placing the copy immediately after the original. */
fun Project.duplicateClip(ids: IdSource, clipId: String): Project {
    val track = editableTrackOf(clipId) ?: return this
    val clip = track.clips.firstOrNull { it.id == clipId } ?: return this
    val copy = clip.copy(
        id = ids.next("clip"),
        timelineStart = clip.timelineEnd,
        linkedClipId = null,
    )
    return replaceTrack(track.id) { t -> t.copy(clips = t.clips + copy) }
}

// --- tracks ------------------------------------------------------------------

fun Project.addTrack(ids: IdSource, kind: TrackKind): Project {
    val existing = tracks.count { it.kind == kind }
    val name = if (kind == TrackKind.VIDEO) "Video ${existing + 1}" else "Audio ${existing + 1}"
    val track = Track(id = ids.next("track"), kind = kind, name = name)
    // Video tracks stay grouped above audio so the timeline reads top-to-bottom
    // in the same order the preview stacks them.
    val (video, audio) = tracks.partition { it.kind == TrackKind.VIDEO }
    val next = if (kind == TrackKind.VIDEO) video + track + audio else video + audio + track
    return copy(tracks = next, revision = revision + 1)
}

/** Removes a track and everything on it. The UI confirms first; the engine just does it. */
fun Project.removeTrack(trackId: String): Project {
    if (tracks.none { it.id == trackId }) return this
    return copy(tracks = tracks.filterNot { it.id == trackId }, revision = revision + 1)
}

fun Project.setTrackLocked(trackId: String, locked: Boolean): Project =
    replaceTrack(trackId) { it.copy(locked = locked) }

fun Project.setTrackMuted(trackId: String, muted: Boolean): Project =
    replaceTrack(trackId) { it.copy(muted = muted) }

fun Project.setTrackSolo(trackId: String, solo: Boolean): Project =
    replaceTrack(trackId) { it.copy(solo = solo) }

fun Project.setTrackVisible(trackId: String, visible: Boolean): Project =
    replaceTrack(trackId) { it.copy(visible = visible) }

// --- clip properties ---------------------------------------------------------

fun Project.setClipVolume(clipId: String, volume: Float): Project {
    val track = editableTrackOf(clipId) ?: return this
    return replaceTrack(track.id) { t ->
        t.replaceClip(clipId) { it.copy(volume = volume.coerceIn(0f, 2f)) }
    }
}

/**
 * Sets constant playback speed, clamped to the PRD's 0.1×–100× range.
 *
 * The clip keeps its source window and changes length on the timeline, which is
 * what makes a speed change feel like retiming rather than trimming.
 */
fun Project.setClipSpeed(clipId: String, speed: Float): Project {
    val track = editableTrackOf(clipId) ?: return this
    return replaceTrack(track.id) { t ->
        t.replaceClip(clipId) { it.copy(speed = speed.coerceIn(0.1f, 100f)) }
    }
}

fun Project.setClipEnabled(clipId: String, enabled: Boolean): Project {
    val track = editableTrackOf(clipId) ?: return this
    return replaceTrack(track.id) { t -> t.replaceClip(clipId) { it.copy(enabled = enabled) } }
}

/** Sets stereo balance, clamped to -1 (full left) .. 1 (full right). */
fun Project.setClipPan(clipId: String, pan: Float): Project {
    val track = editableTrackOf(clipId) ?: return this
    return replaceTrack(track.id) { t ->
        t.replaceClip(clipId) { it.copy(pan = pan.coerceIn(-1f, 1f)) }
    }
}

/**
 * Sets the fade-in length, clamped to the clip's own timeline duration.
 *
 * A fade longer than the clip cannot be represented, so it is clamped rather
 * than accepted and silently truncated at render time — the slider that set
 * it should show the same value that will actually play.
 */
fun Project.setClipFadeIn(clipId: String, duration: Ticks): Project {
    val track = editableTrackOf(clipId) ?: return this
    val clip = clip(clipId) ?: return this
    val clamped = duration.coerceIn(Ticks.ZERO, clip.timelineDuration)
    return replaceTrack(track.id) { t -> t.replaceClip(clipId) { it.copy(fadeInDuration = clamped) } }
}

/** Sets the fade-out length, clamped to the clip's own timeline duration. */
fun Project.setClipFadeOut(clipId: String, duration: Ticks): Project {
    val track = editableTrackOf(clipId) ?: return this
    val clip = clip(clipId) ?: return this
    val clamped = duration.coerceIn(Ticks.ZERO, clip.timelineDuration)
    return replaceTrack(track.id) { t -> t.replaceClip(clipId) { it.copy(fadeOutDuration = clamped) } }
}

// --- media -------------------------------------------------------------------

fun Project.addMedia(ref: MediaRef): Project =
    if (media.any { it.id == ref.id }) this
    else copy(media = media + ref, revision = revision + 1)

/** Points a media reference at a new location. The missing-media relink flow. */
fun Project.relinkMedia(mediaId: String, uri: String): Project {
    val index = media.indexOfFirst { it.id == mediaId }
    if (index < 0) return this
    return copy(
        media = media.toMutableList().also { it[index] = it[index].copy(uri = uri, available = true) },
        revision = revision + 1,
    )
}

fun Project.rename(name: String): Project =
    if (name == this.name) this else copy(name = name, revision = revision + 1)

// --- markers -------------------------------------------------------------

/**
 * Adds a marker at [at].
 *
 * Unlike a keyframe, a marker is not scoped to a clip — it names a point on the
 * *timeline*, so it stays where it is when a clip moves rather than travelling
 * with one. A blank [name] is given a timecode-free placeholder rather than
 * left empty, since an unnamed marker in a list of markers is not something a
 * user can pick out later.
 */
fun Project.addMarker(
    ids: IdSource,
    at: Ticks,
    name: String = "Marker",
    note: String = "",
    colorTag: ColorTag? = null,
): Project = copy(
    markers = (markers + Marker(ids.next("marker"), at.coerceAtLeast(Ticks.ZERO), name, note, colorTag))
        .sortedBy { it.time.raw },
    revision = revision + 1,
)

fun Project.removeMarker(markerId: String): Project {
    if (markers.none { it.id == markerId }) return this
    return copy(markers = markers.filterNot { it.id == markerId }, revision = revision + 1)
}

fun Project.renameMarker(markerId: String, name: String, note: String = ""): Project {
    val index = markers.indexOfFirst { it.id == markerId }
    if (index < 0) return this
    val updated = markers[index].copy(name = name, note = note)
    if (updated == markers[index]) return this
    return copy(markers = markers.toMutableList().also { it[index] = updated }, revision = revision + 1)
}

fun Project.setMarkerColorTag(markerId: String, colorTag: ColorTag?): Project {
    val index = markers.indexOfFirst { it.id == markerId }
    if (index < 0) return this
    if (markers[index].colorTag == colorTag) return this
    return copy(
        markers = markers.toMutableList().also { it[index] = it[index].copy(colorTag = colorTag) },
        revision = revision + 1,
    )
}

/** Drags a marker along the timeline. Clamped to zero; markers keep their order. */
fun Project.moveMarker(markerId: String, to: Ticks): Project {
    val index = markers.indexOfFirst { it.id == markerId }
    if (index < 0) return this
    val target = to.coerceAtLeast(Ticks.ZERO)
    if (markers[index].time == target) return this
    return copy(
        markers = (markers.toMutableList().also { it[index] = it[index].copy(time = target) })
            .sortedBy { it.time.raw },
        revision = revision + 1,
    )
}

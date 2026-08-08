package com.apexedits.core.model

/**
 * Construction helpers.
 *
 * Ids are supplied by the caller through [IdSource] rather than generated with
 * `UUID.randomUUID()` inside the model, so engine tests are deterministic and
 * the same document can be rebuilt from the same inputs.
 */
fun interface IdSource {
    fun next(prefix: String): String
}

/** Sequential ids: `clip-1`, `clip-2`, … Used by tests and by the editor alike. */
class CountingIdSource(private var counter: Long = 0) : IdSource {
    override fun next(prefix: String): String = "$prefix-${++counter}"
}

/**
 * A new project with a starting track layout.
 *
 * The PRD asks for unlimited tracks with soft limits on weak devices, so no cap
 * is encoded here. [videoTracks] and [audioTracks] are the starting layout only;
 * `addTrack` grows it without bound and the device policy decides when to warn.
 */
fun createProject(
    ids: IdSource,
    name: String,
    format: ProjectFormat,
    videoTracks: Int = 2,
    audioTracks: Int = 2,
    nowEpochMs: Long = 0L,
): Project {
    val video = (1..videoTracks).map { index ->
        Track(id = ids.next("track"), kind = TrackKind.VIDEO, name = "Video $index")
    }
    val audio = (1..audioTracks).map { index ->
        Track(id = ids.next("track"), kind = TrackKind.AUDIO, name = "Audio $index")
    }
    return Project(
        id = ids.next("project"),
        name = name,
        format = format,
        // Video tracks are listed top-down as they stack in the preview: the
        // first entry is the bottom layer, so higher indices draw over it.
        tracks = video + audio,
        createdAtEpochMs = nowEpochMs,
        modifiedAtEpochMs = nowEpochMs,
    )
}

/** A clip covering the whole of [media], placed at [at]. */
fun createClip(
    ids: IdSource,
    media: MediaRef,
    at: Ticks = Ticks.ZERO,
): Clip = Clip(
    id = ids.next("clip"),
    mediaId = media.id,
    timelineStart = at,
    sourceIn = Ticks.ZERO,
    sourceOut = media.duration,
    label = media.displayName,
)

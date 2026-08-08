package com.apexedits.core.model

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * The document is stored as JSON, so a round trip has to be exact — a project
 * that reopens a frame off, or with a lost speed setting, is worse than one that
 * fails to open, because the damage is silent.
 */
class SerializationTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private fun sample(): Project {
        val ids = CountingIdSource()
        val media = MediaRef(
            id = "media-1",
            uri = "content://media/external/video/media/42",
            displayName = "holiday.mp4",
            kind = MediaKind.VIDEO,
            duration = Ticks.ofSeconds(12.5),
            width = 1920,
            height = 1080,
            rotationDegrees = 90,
            hasAudio = true,
            sizeBytes = 48_000_000,
        )
        val project = createProject(
            ids = ids,
            name = "Holiday cut",
            format = ProjectFormat.of(AspectRatio.VERTICAL_9_16, 1920, FrameRate.FPS_29_97),
            nowEpochMs = 1_700_000_000_000,
        ).copy(media = listOf(media))

        val trackId = project.videoTracks.first().id
        val clip = Clip(
            id = "clip-x",
            mediaId = media.id,
            timelineStart = Ticks.ofSeconds(2.0),
            sourceIn = Ticks.ofSeconds(1.0),
            sourceOut = Ticks.ofSeconds(9.0),
            transform = Transform(positionX = 12f, scaleX = 1.4f, rotationDegrees = 7.5f, opacity = 0.8f),
            volume = 0.6f,
            speed = 1.75f,
            colorTag = ColorTag.BLUE,
        )
        return project.copy(
            tracks = project.tracks.map { if (it.id == trackId) it.copy(clips = listOf(clip)) else it },
            markers = listOf(Marker("m1", Ticks.ofSeconds(4.0), "Chorus", note = "cut here")),
        )
    }

    @Test
    fun `a project survives a round trip unchanged`() {
        val original = sample()
        val restored = json.decodeFromString(Project.serializer(), json.encodeToString(Project.serializer(), original))
        assertEquals(original, restored)
    }

    @Test
    fun `tick values survive exactly, not approximately`() {
        val original = sample()
        val restored = json.decodeFromString(Project.serializer(), json.encodeToString(Project.serializer(), original))
        val clip = restored.clip("clip-x")!!

        // Exact equality, not a delta: a Long that round-trips through a JSON
        // number as a double would lose precision, and this is the assertion
        // that would catch it.
        assertEquals(Ticks.ofSeconds(2.0).raw, clip.timelineStart.raw)
        assertEquals(Ticks.ofSeconds(1.0).raw, clip.sourceIn.raw)
        assertEquals(Ticks.ofSeconds(9.0).raw, clip.sourceOut.raw)
    }

    @Test
    fun `the ntsc frame rate stays rational rather than becoming a decimal`() {
        val original = sample()
        val restored = json.decodeFromString(Project.serializer(), json.encodeToString(Project.serializer(), original))
        assertEquals(30_000, restored.format.frameRate.numerator)
        assertEquals(1001, restored.format.frameRate.denominator)
    }

    @Test
    fun `a document written by a newer build still opens`() {
        // Forward compatibility: an unknown field must be skipped, not fatal, so
        // that installing an older build does not make projects unopenable.
        val encoded = json.encodeToString(Project.serializer(), sample())
        val withFutureField = encoded.replaceFirst("{", """{"colorGrade":{"exposure":0.5},""")

        val restored = json.decodeFromString(Project.serializer(), withFutureField)
        assertNotNull(restored)
        assertEquals("Holiday cut", restored.name)
    }

    @Test
    fun `derived values are recomputed rather than stored`() {
        val restored = json.decodeFromString(
            Project.serializer(),
            json.encodeToString(Project.serializer(), sample()),
        )
        val clip = restored.clip("clip-x")!!
        // timelineDuration is derived from the source window and speed, so it
        // cannot disagree with them after a round trip.
        assertEquals(Ticks((clip.sourceDuration.raw / clip.speed).toLong()), clip.timelineDuration)
        assertEquals(clip.timelineStart + clip.timelineDuration, clip.timelineEnd)
    }
}

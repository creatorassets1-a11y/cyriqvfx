package com.apexedits.core.data

import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.apexedits.core.model.MediaKind
import com.apexedits.core.model.SampleVideo
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowMediaMetadataRetriever
import java.io.File

/**
 * Import, driven by a real recording's metadata.
 *
 * `ShadowMediaMetadataRetriever` lets a test program exactly what the retriever
 * will report, so the mapping can be exercised against the values a genuine
 * 33-second phone clip produced rather than against invented ones. The file
 * itself is not in the repository; its measurements are, in `SampleVideo`.
 *
 * The case that actually matters here is rotation. Phones record portrait video
 * as landscape frames plus a rotation flag, so a naive import lays every
 * vertically-shot clip out sideways on the timeline.
 */
@RunWith(RobolectricTestRunner::class)
class MediaImporterTest {

    private lateinit var importer: MediaImporter

    @Before
    fun setUp() {
        importer = MediaImporter(ApplicationProvider.getApplicationContext())
    }

    private fun programRetriever(
        uri: Uri,
        durationMs: Long = SampleVideo.DURATION_MS,
        width: Int = SampleVideo.WIDTH,
        height: Int = SampleVideo.HEIGHT,
        rotation: Int = SampleVideo.ROTATION_DEGREES,
        hasVideo: String = "yes",
        hasAudio: String = "yes",
    ) {
        fun put(key: Int, value: String) =
            ShadowMediaMetadataRetriever.addMetadata(uri.toString(), key, value)

        put(MediaMetadataRetriever.METADATA_KEY_DURATION, durationMs.toString())
        put(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH, width.toString())
        put(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT, height.toString())
        put(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION, rotation.toString())
        put(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO, hasVideo)
        put(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO, hasAudio)
    }

    private fun registerMimeType(uri: Uri, mimeType: String) {
        shadowOf(ApplicationProvider.getApplicationContext<android.content.Context>().contentResolver)
            .registerInputStream(uri, "fake".byteInputStream())
        ShadowMediaMetadataRetriever.addMetadata(
            uri.toString(),
            MediaMetadataRetriever.METADATA_KEY_MIMETYPE,
            mimeType,
        )
    }

    @Test
    fun `the sample clip's metadata maps onto a media reference`() = runTest {
        val uri = Uri.parse("content://media/external/video/media/42")
        programRetriever(uri)
        registerMimeType(uri, SampleVideo.MIME_TYPE)

        val ref = importer.import(uri, "media-1")

        assertNotNull(ref)
        assertEquals(MediaKind.VIDEO, ref!!.kind)
        // The duration the container reported, converted exactly.
        assertEquals(SampleVideo.duration, ref.duration)
        assertEquals(SampleVideo.WIDTH, ref.width)
        assertEquals(SampleVideo.HEIGHT, ref.height)
        assertTrue(ref.hasAudio)
        assertTrue(ref.available)
    }

    @Test
    fun `a portrait clip stored landscape is reported in its displayed shape`() = runTest {
        val uri = Uri.parse("content://media/external/video/media/43")
        // What a phone actually writes for a vertical recording: a landscape
        // frame plus a rotation flag.
        programRetriever(uri, width = 1920, height = 1080, rotation = 90)
        registerMimeType(uri, "video/mp4")

        val ref = importer.import(uri, "media-2")!!

        // The timeline needs the shape the viewer sees, or every vertically-shot
        // clip lays out sideways.
        assertEquals(1080, ref.width)
        assertEquals(1920, ref.height)
        assertEquals(90, ref.rotationDegrees)
    }

    @Test
    fun `270 degrees also swaps the reported dimensions`() = runTest {
        val uri = Uri.parse("content://media/external/video/media/44")
        programRetriever(uri, width = 1920, height = 1080, rotation = 270)
        registerMimeType(uri, "video/mp4")

        val ref = importer.import(uri, "media-3")!!
        assertEquals(1080, ref.width)
        assertEquals(1920, ref.height)
    }

    @Test
    fun `180 degrees leaves the dimensions alone`() = runTest {
        val uri = Uri.parse("content://media/external/video/media/45")
        programRetriever(uri, width = 1920, height = 1080, rotation = 180)
        registerMimeType(uri, "video/mp4")

        val ref = importer.import(uri, "media-4")!!
        // Upside down is still landscape.
        assertEquals(1920, ref.width)
        assertEquals(1080, ref.height)
    }

    @Test
    fun `an audio-only file imports as audio`() = runTest {
        val uri = Uri.parse("content://media/external/audio/media/1")
        programRetriever(uri, width = 0, height = 0, hasVideo = "no", hasAudio = "yes")
        registerMimeType(uri, "audio/mpeg")

        val ref = importer.import(uri, "media-5")!!
        assertEquals(MediaKind.AUDIO, ref.kind)
        assertTrue(ref.hasAudio)
    }

    @Test
    fun `a still gets a default duration it can be trimmed from`() = runTest {
        val uri = Uri.parse("content://media/external/images/media/1")
        programRetriever(uri, durationMs = 0, hasVideo = "no", hasAudio = "no")
        registerMimeType(uri, "image/jpeg")

        val ref = importer.import(uri, "media-6")!!
        assertEquals(MediaKind.IMAGE, ref.kind)
        // A still has no duration of its own; five seconds is the convention and
        // the user trims it like any other clip.
        assertEquals(MediaImporter.DEFAULT_IMAGE_DURATION, ref.duration)
    }

    @Test
    fun `an unreadable file is skipped rather than throwing`() = runTest {
        val uri = Uri.parse("content://media/external/video/media/999")
        // Nothing programmed: the retriever finds no metadata at all.

        // One corrupt file in a multi-select must not lose the other nine, so
        // this reports nothing instead of failing the batch.
        assertNull(importer.import(uri, "media-7"))
    }

    @Test
    fun `a video with no duration is rejected`() = runTest {
        val uri = Uri.parse("content://media/external/video/media/998")
        programRetriever(uri, durationMs = 0)
        registerMimeType(uri, "video/mp4")

        // A zero-length clip would occupy no timeline and could never be
        // selected; better not to import it.
        assertNull(importer.import(uri, "media-8"))
    }

    @Test
    fun `availability reflects whether the file still resolves`() = runTest {
        // Real files on disk rather than content URIs: Robolectric's resolver
        // hands back a stream for any unregistered content URI, so a "missing"
        // one would look present and the test would prove nothing.
        val present = File.createTempFile("apex-present", ".mp4").apply {
            writeBytes(ByteArray(16))
            deleteOnExit()
        }
        val missing = File(present.parentFile, "apex-deleted-${System.nanoTime()}.mp4")

        val refs = listOf(
            SampleVideo.mediaRef(id = "a", uri = Uri.fromFile(present).toString()),
            SampleVideo.mediaRef(id = "b", uri = Uri.fromFile(missing).toString()),
        )

        val refreshed = importer.refreshAvailability(refs)

        // A file deleted between sessions comes back unavailable, which keeps the
        // clip on the timeline for the relink flow instead of dropping it.
        assertTrue(refreshed.first { it.id == "a" }.available)
        assertFalse(refreshed.first { it.id == "b" }.available)
    }

    @Test
    fun `the picker asks for a persistable grant`() {
        val intent = importer.pickIntent()

        // ACTION_GET_CONTENT cannot grant persistable permission, so a project
        // reopened tomorrow would be a wall of missing media.
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.action)
        assertTrue(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
    }
}

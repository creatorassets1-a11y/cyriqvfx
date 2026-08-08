package com.apexedits.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.apexedits.core.engine.edit.appendClip
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.SampleVideo
import com.apexedits.core.model.createClip
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * Persistence, tested for real.
 *
 * This layer had no tests at all, which is uncomfortable for the part of the app
 * that is responsible for not losing someone's work. Robolectric runs the Android
 * framework on the JVM, so Room, SQLite and real file I/O all execute here
 * without needing the emulator this host cannot run.
 *
 * The project under test is shaped from the sample clip's real metadata, so what
 * is written and read back is a document that could actually exist.
 */
@RunWith(RobolectricTestRunner::class)
class ProjectStoreTest {

    private lateinit var context: Context
    private lateinit var database: ProjectDatabase
    private lateinit var store: ProjectStore

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        database = Room.inMemoryDatabaseBuilder(context, ProjectDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        store = ProjectStore(context, database.projectDao())
    }

    @After
    fun tearDown() {
        database.close()
    }

    private fun sampleProject() = CountingIdSource().let { ids ->
        val project = SampleVideo.project(ids)
        project.appendClip(project.videoTracks.first().id, createClip(ids, SampleVideo.mediaRef()))
    }

    // --- folder layout -------------------------------------------------------

    @Test
    fun `creating a project builds its self-contained folder`() = runTest {
        val project = sampleProject()
        store.create(project)

        // The layout is what makes "export project package" a zip of a directory
        // later, so each part has to actually exist.
        assertTrue(store.folderFor(project.id).isDirectory)
        assertTrue(store.mediaDir(project.id).isDirectory)
        assertTrue(store.proxyDir(project.id).isDirectory)
        assertTrue(store.thumbnailDir(project.id).isDirectory)
        assertTrue(store.documentFile(project.id).isFile)
    }

    @Test
    fun `a created project is indexed with the columns the list screen sorts on`() = runTest {
        val project = sampleProject()
        store.create(project)

        val row = database.projectDao().byId(project.id)
        assertNotNull(row)
        assertEquals(SampleVideo.WIDTH, row!!.width)
        assertEquals(SampleVideo.HEIGHT, row.height)
        assertEquals(30, row.frameRateNumerator)
        assertEquals(1, row.frameRateDenominator)
        assertEquals(1, row.clipCount)
        // Cached so the projects list never has to parse a document to draw a row.
        assertEquals(SampleVideo.duration.raw, row.durationTicks)
    }

    @Test
    fun `a project round-trips through disk unchanged`() = runTest {
        val project = sampleProject()
        store.create(project)

        val loaded = store.load(project.id)
        assertNotNull(loaded)
        assertEquals(project, loaded!!.project)
        // Specifically, the real clip's exact tick values survived.
        assertEquals(SampleVideo.duration, loaded.project.duration)
    }

    // --- autosave and crash recovery ----------------------------------------

    @Test
    fun `a newer autosave is offered rather than opened silently`() = runTest {
        val project = sampleProject()
        store.create(project)

        // Simulate an edit that was autosaved but never committed.
        val edited = project.copy(name = "Edited", revision = project.revision + 1)
        store.autosave(edited)

        val loaded = store.load(project.id)!!
        // The last deliberate save is what opens...
        assertEquals(project.name, loaded.project.name)
        // ...and the newer work is offered, not imposed. Silently taking it would
        // discard whatever the user last chose to save without telling them.
        assertTrue(loaded.hasRecovery)
        assertEquals("Edited", loaded.recovered!!.name)
    }

    @Test
    fun `an autosave older than the saved document is not offered`() = runTest {
        val project = sampleProject().copy(revision = 5)
        store.create(project)
        store.autosave(project.copy(revision = 3))

        val loaded = store.load(project.id)!!
        assertFalse(loaded.hasRecovery)
        assertNull(loaded.recovered)
    }

    @Test
    fun `committing promotes the autosave and clears it`() = runTest {
        val project = sampleProject()
        store.create(project)
        val edited = project.copy(name = "Committed", revision = project.revision + 1)
        store.autosave(edited)
        assertTrue(store.autosaveFile(project.id).exists())

        store.commit(edited)

        assertFalse(store.autosaveFile(project.id).exists())
        val loaded = store.load(project.id)!!
        assertEquals("Committed", loaded.project.name)
        assertFalse(loaded.hasRecovery)
    }

    @Test
    fun `an interrupted session is discoverable at launch`() = runTest {
        val project = sampleProject()
        store.create(project)
        store.markOpen(project.id, open = true)

        // The flag is still set because the editor never closed cleanly.
        assertEquals(project.id, store.findInterruptedSession()?.id)

        store.commit(project)
        assertNull(store.findInterruptedSession())
    }

    // --- durability ----------------------------------------------------------

    @Test
    fun `a stray temporary file does not corrupt the saved document`() = runTest {
        val project = sampleProject()
        store.create(project)

        // What a process killed mid-write leaves behind. The real document must
        // still be the one that loads — this is the atomic-rename claim.
        File(store.folderFor(project.id), "project.json.tmp").writeText("{ truncated")

        val loaded = store.load(project.id)
        assertNotNull(loaded)
        assertEquals(project.name, loaded!!.project.name)
    }

    @Test
    fun `an unreadable document reports nothing rather than throwing`() = runTest {
        val project = sampleProject()
        store.create(project)
        store.documentFile(project.id).writeText("this is not json")

        // A corrupt file must not take the app down on launch.
        assertNull(store.load(project.id))
    }

    @Test
    fun `loading a project that was never created returns null`() = runTest {
        assertNull(store.load("no-such-project"))
    }

    // --- housekeeping --------------------------------------------------------

    @Test
    fun `deleting removes both the folder and the index row`() = runTest {
        val project = sampleProject()
        store.create(project)

        store.delete(project.id)

        assertFalse(store.folderFor(project.id).exists())
        assertNull(database.projectDao().byId(project.id))
    }

    @Test
    fun `clearing caches spares the document`() = runTest {
        val project = sampleProject()
        store.create(project)
        File(store.proxyDir(project.id), "proxy.mp4").writeText("x")
        File(store.thumbnailDir(project.id), "t.jpg").writeText("x")

        store.clearCaches(project.id)

        // Generated files go; the edit does not. Proxies and thumbnails rebuild
        // from the source media, so losing them costs seconds.
        assertEquals(0, store.proxyDir(project.id).listFiles()!!.size)
        assertEquals(0, store.thumbnailDir(project.id).listFiles()!!.size)
        assertTrue(store.documentFile(project.id).isFile)
    }

    @Test
    fun `folder size counts everything under the project`() = runTest {
        val project = sampleProject()
        store.create(project)
        File(store.proxyDir(project.id), "proxy.mp4").writeBytes(ByteArray(1024))

        // Drives the Settings storage screen, so it has to include the caches
        // rather than just the document.
        assertTrue(store.folderSizeBytes(project.id) > 1024)
    }

    @Test
    fun `renaming updates both the index and the document`() = runTest {
        val project = sampleProject()
        store.create(project)

        store.rename(project.id, "Holiday cut")

        assertEquals("Holiday cut", database.projectDao().byId(project.id)!!.name)
        assertEquals("Holiday cut", store.load(project.id)!!.project.name)
    }

    // --- the Settings storage screen ------------------------------------------

    @Test
    fun `the storage breakdown separates footage from generated caches`() = runTest {
        val project = sampleProject()
        store.create(project)
        File(store.mediaDir(project.id), "clip.mp4").writeBytes(ByteArray(5_000))
        File(store.proxyDir(project.id), "proxy.mp4").writeBytes(ByteArray(1_000))
        File(store.thumbnailDir(project.id), "thumb.jpg").writeBytes(ByteArray(200))

        val breakdown = store.storageBreakdown()

        // The point of a breakdown rather than one total: the user needs to see
        // whether space is going to their footage or to caches before deciding
        // what, if anything, to clear.
        assertTrue(breakdown.mediaBytes >= 5_000)
        assertTrue(breakdown.proxyBytes >= 1_000)
        assertTrue(breakdown.thumbnailBytes >= 200)
        assertTrue(breakdown.documentsBytes > 0)
        assertEquals(
            breakdown.documentsBytes + breakdown.mediaBytes + breakdown.proxyBytes + breakdown.thumbnailBytes,
            breakdown.totalBytes,
        )
    }

    @Test
    fun `clearing all caches empties every project's caches but keeps documents and media`() = runTest {
        val first = sampleProject()
        // A distinct id source seeded away from zero: sampleProject() always
        // starts counting from zero, so a second default-seeded project here
        // would collide on the same id and overwrite the first in the index.
        val second = SampleVideo.project(CountingIdSource(1_000), name = "Second")
        store.create(first)
        store.create(second)
        File(store.proxyDir(first.id), "a.mp4").writeBytes(ByteArray(100))
        File(store.proxyDir(second.id), "b.mp4").writeBytes(ByteArray(100))
        File(store.mediaDir(first.id), "kept.mp4").writeBytes(ByteArray(100))

        store.clearAllCaches()

        assertEquals(0, store.proxyDir(first.id).listFiles()!!.size)
        assertEquals(0, store.proxyDir(second.id).listFiles()!!.size)
        // Footage and the document itself are never touched by a cache clear.
        assertTrue(File(store.mediaDir(first.id), "kept.mp4").exists())
        assertTrue(store.documentFile(first.id).isFile)
    }

    @Test
    fun `storage breakdown on an empty library is all zero`() = runTest {
        val breakdown = store.storageBreakdown()
        assertEquals(0L, breakdown.totalBytes)
    }
}

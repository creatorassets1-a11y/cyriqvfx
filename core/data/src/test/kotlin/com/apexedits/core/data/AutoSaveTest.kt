package com.apexedits.core.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.SampleVideo
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Auto-save timing.
 *
 * The debounce is the part worth testing: too eager and a slider drag writes the
 * document sixty times a second, too lazy and a crash costs real work. These
 * drive a virtual clock, so the two-second window is exercised without the tests
 * taking two seconds.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class AutoSaveTest {

    private lateinit var database: ProjectDatabase

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        database = Room.inMemoryDatabaseBuilder(context, ProjectDatabase::class.java)
            .allowMainThreadQueries()
            .build()
    }

    @After
    fun tearDown() = database.close()

    /**
     * A store whose file writes run on the test clock.
     *
     * `ProjectStore` takes its IO dispatcher as a parameter precisely so a test
     * can do this — with the real `Dispatchers.IO` the debounced write lands on
     * another thread and the assertions race it.
     */
    private fun storeOn(dispatcher: CoroutineDispatcher) = ProjectStore(
        ApplicationProvider.getApplicationContext(),
        database.projectDao(),
        dispatcher,
    )

    private fun project() = SampleVideo.project(CountingIdSource())

    @Test
    fun `a burst of edits collapses into a single write`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val store = storeOn(dispatcher)
        val base = project()
        store.create(base)

        val scope = TestScope(dispatcher)
        val autoSave = AutoSave(store, scope)
        autoSave.start()

        // Sixty frames of a slider drag, one every 16 ms.
        repeat(60) { step ->
            autoSave.record(base.copy(name = "step $step", revision = step + 1L))
            scope.advanceTimeBy(16)
        }
        scope.advanceUntilIdle()

        // Only the final state reached disk. Writing each frame would be sixty
        // file writes for one gesture.
        assertEquals("step 59", store.load(base.id)!!.recovered?.name)
    }

    @Test
    fun `nothing is written before the quiet period elapses`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val store = storeOn(dispatcher)
        val base = project()
        store.create(base)

        val scope = TestScope(dispatcher)
        val autoSave = AutoSave(store, scope)
        autoSave.start()

        autoSave.record(base.copy(revision = 1))
        scope.advanceTimeBy(AutoSave.QUIET_PERIOD_MS - 100)

        assertFalse(store.autosaveFile(base.id).exists())

        scope.advanceTimeBy(200)
        scope.advanceUntilIdle()
        assertTrue(store.autosaveFile(base.id).exists())
    }

    @Test
    fun `an unchanged revision is not written again`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val store = storeOn(dispatcher)
        val base = project()
        store.create(base)

        val scope = TestScope(dispatcher)
        val autoSave = AutoSave(store, scope)
        autoSave.start()

        autoSave.record(base.copy(revision = 7))
        scope.advanceUntilIdle()
        val firstWrite = store.autosaveFile(base.id).lastModified()

        // The revision counter only advances on a real change, so an operation
        // that clamped to a no-op must not cost a write.
        autoSave.record(base.copy(revision = 7))
        scope.advanceUntilIdle()

        assertEquals(firstWrite, store.autosaveFile(base.id).lastModified())
    }

    @Test
    fun `flush writes immediately, bypassing the debounce`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val store = storeOn(dispatcher)
        val base = project()
        store.create(base)

        val scope = TestScope(dispatcher)
        val autoSave = AutoSave(store, scope)
        autoSave.start()

        autoSave.record(base.copy(name = "backgrounded", revision = 1))
        // The app is going to the background: there may be no next moment, so
        // the debounce window is a window in which work is lost.
        autoSave.flush()

        assertEquals("backgrounded", store.load(base.id)!!.recovered?.name)
    }

    @Test
    fun `commit promotes the document and clears the open flag`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val store = storeOn(dispatcher)
        val base = project()
        store.create(base)
        store.markOpen(base.id, open = true)

        val scope = TestScope(dispatcher)
        val autoSave = AutoSave(store, scope)
        autoSave.start()

        autoSave.record(base.copy(name = "final", revision = 1))
        autoSave.commit()

        val loaded = store.load(base.id)!!
        assertEquals("final", loaded.project.name)
        assertFalse(loaded.hasRecovery)
        assertNull(store.findInterruptedSession())
    }

    @Test
    fun `flushing with nothing recorded is harmless`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val store = storeOn(dispatcher)
        val scope = TestScope(dispatcher)
        val autoSave = AutoSave(store, scope)
        autoSave.start()

        autoSave.flush()
        autoSave.commit()

        assertNull(autoSave.lastError.value)
    }
}

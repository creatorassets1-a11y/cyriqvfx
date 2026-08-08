package com.apexedits.core.data

import androidx.test.core.app.ApplicationProvider
import com.apexedits.core.device.HeavyOperation
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * "Don't show again for this device", made to actually persist.
 *
 * The PRD's low-resource dialog offers this as one of three buttons; a version
 * backed only by in-memory view-model state would silently break that promise
 * the moment the app process is killed and reopened, which on Android is not a
 * rare event. DataStore is what makes it survive that.
 */
@RunWith(RobolectricTestRunner::class)
class DevicePreferencesTest {

    private val preferences = DevicePreferences(ApplicationProvider.getApplicationContext())

    @Test
    fun `nothing is suppressed by default`() = runTest {
        assertFalse(preferences.isSuppressed(HeavyOperation.EXPORT_HIGH_RESOLUTION).first())
    }

    @Test
    fun `suppressing one operation does not suppress another`() = runTest {
        preferences.setSuppressed(HeavyOperation.EXPORT_HIGH_RESOLUTION, true)

        // Dismissing the export warning must not silence the import warning too —
        // they are different risks with different consequences.
        assertTrue(preferences.isSuppressed(HeavyOperation.EXPORT_HIGH_RESOLUTION).first())
        assertFalse(preferences.isSuppressed(HeavyOperation.IMPORT_HIGH_RESOLUTION).first())
    }

    @Test
    fun `un-suppressing restores the warning`() = runTest {
        preferences.setSuppressed(HeavyOperation.MANY_LAYERS, true)
        preferences.setSuppressed(HeavyOperation.MANY_LAYERS, false)
        assertFalse(preferences.isSuppressed(HeavyOperation.MANY_LAYERS).first())
    }

    @Test
    fun `reset warnings clears every suppression at once`() = runTest {
        preferences.setSuppressed(HeavyOperation.MANY_LAYERS, true)
        preferences.setSuppressed(HeavyOperation.EXPORT_HIGH_RESOLUTION, true)

        preferences.resetWarnings()

        assertFalse(preferences.isSuppressed(HeavyOperation.MANY_LAYERS).first())
        assertFalse(preferences.isSuppressed(HeavyOperation.EXPORT_HIGH_RESOLUTION).first())
    }

    @Test
    fun `always-use-full-quality defaults to off and can be toggled`() = runTest {
        assertFalse(preferences.alwaysUseFullQuality.first())
        preferences.setAlwaysUseFullQuality(true)
        assertTrue(preferences.alwaysUseFullQuality.first())
    }
}

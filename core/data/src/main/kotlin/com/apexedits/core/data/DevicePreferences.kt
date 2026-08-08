package com.apexedits.core.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.apexedits.core.device.HeavyOperation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * The delegate is declared at file scope rather than inside [DevicePreferences]
 * because Kotlin only allows a property-delegate extension to be a top-level (or
 * companion) declaration — `by preferencesDataStore(...)` cannot reference `this`
 * from inside a class body. One file-scoped [Context] extension, used only here.
 */
private val Context.devicePreferencesStore by preferencesDataStore(name = "device_preferences")

/**
 * Settings that belong to *this device*, not to any project.
 *
 * The PRD's low-resource dialog offers "Don't show again for this device" as one
 * of its three buttons. That has to survive the app being killed and reopened —
 * a warning that resets every launch is not what "don't show again" promises —
 * so it is backed by DataStore rather than in-memory view-model state.
 *
 * Suppression is per [HeavyOperation] rather than global: dismissing the export
 * warning should not silence the import warning too, since they are different
 * risks with different consequences.
 */
class DevicePreferences(private val context: Context) {

    /** Whether the low-resource warning for [operation] has been suppressed. */
    fun isSuppressed(operation: HeavyOperation): Flow<Boolean> =
        context.devicePreferencesStore.data.map { prefs ->
            operation.name in (prefs[SUPPRESSED_OPERATIONS] ?: emptySet())
        }

    suspend fun setSuppressed(operation: HeavyOperation, suppressed: Boolean) {
        context.devicePreferencesStore.edit { prefs ->
            val current = prefs[SUPPRESSED_OPERATIONS] ?: emptySet()
            prefs[SUPPRESSED_OPERATIONS] = if (suppressed) current + operation.name else current - operation.name
        }
    }

    /** Clears every suppressed warning. Exposed on the Settings screen. */
    suspend fun resetWarnings() {
        context.devicePreferencesStore.edit { prefs -> prefs.remove(SUPPRESSED_OPERATIONS) }
    }

    /**
     * Whether the user has forced full quality regardless of device tier.
     *
     * Distinct from the per-operation suppressions: this is "always allow on this
     * device" from the PRD's warning-dialog copy, a broader override that skips
     * the classifier's tier entirely rather than one specific warning.
     */
    val alwaysUseFullQuality: Flow<Boolean> =
        context.devicePreferencesStore.data.map { it[ALWAYS_FULL_QUALITY] ?: false }

    suspend fun setAlwaysUseFullQuality(enabled: Boolean) {
        context.devicePreferencesStore.edit { it[ALWAYS_FULL_QUALITY] = enabled }
    }

    private companion object {
        val SUPPRESSED_OPERATIONS = stringSetPreferencesKey("suppressed_operations")
        val ALWAYS_FULL_QUALITY = booleanPreferencesKey("always_full_quality")
    }
}

package com.apexedits.feature.settings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.apexedits.core.data.DevicePreferences
import com.apexedits.core.data.ProjectDatabase
import com.apexedits.core.data.ProjectStore
import com.apexedits.core.device.DeviceProfile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Settings.
 *
 * The PRD groups this screen as Performance, Storage, Accessibility/theme, and
 * About/Licences — four concerns that share nothing but a screen, so the state
 * here is likewise four independent pieces rather than one intertwined model.
 */
class SettingsViewModel(application: Application) : AndroidViewModel(application) {

    private val database = ProjectDatabase.get(application)
    private val store = ProjectStore(application, database.projectDao())
    private val preferences = DevicePreferences(application)

    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            _state.value = _state.value.copy(deviceProfile = DeviceProfile.read(application))
        }
        // A separate coroutine: this one never returns, since it collects the
        // preference for as long as the screen is open. Sharing it with the
        // one-shot device read above would leave that read waiting forever.
        viewModelScope.launch {
            preferences.alwaysUseFullQuality.collect { enabled ->
                _state.value = _state.value.copy(alwaysUseFullQuality = enabled)
            }
        }
        refreshStorage()
    }

    private fun refreshStorage() {
        viewModelScope.launch {
            val breakdown = store.storageBreakdown()
            _state.value = _state.value.copy(storage = breakdown, isLoadingStorage = false)
        }
    }

    fun setAlwaysUseFullQuality(enabled: Boolean) {
        viewModelScope.launch { preferences.setAlwaysUseFullQuality(enabled) }
    }

    fun resetWarnings() {
        viewModelScope.launch {
            preferences.resetWarnings()
            _state.value = _state.value.copy(message = "Low-resource warnings will show again.")
        }
    }

    fun clearAllCaches() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoadingStorage = true)
            store.clearAllCaches()
            refreshStorage()
            _state.value = _state.value.copy(
                message = "Cleared cached previews and proxies. Your projects and media are untouched.",
            )
        }
    }

    fun clearMessage() {
        _state.value = _state.value.copy(message = null)
    }
}

data class SettingsUiState(
    val deviceProfile: DeviceProfile? = null,
    val storage: ProjectStore.StorageBreakdown? = null,
    val isLoadingStorage: Boolean = true,
    val alwaysUseFullQuality: Boolean = false,
    val message: String? = null,
)

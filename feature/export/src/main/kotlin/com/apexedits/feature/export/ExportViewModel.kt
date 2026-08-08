package com.apexedits.feature.export

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.apexedits.core.data.ProjectDatabase
import com.apexedits.core.data.ProjectStore
import com.apexedits.core.device.DeviceProfile
import com.apexedits.core.device.PerformancePolicy
import com.apexedits.core.model.Ticks
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class ExportViewModel(
    application: Application,
    private val projectId: String,
) : AndroidViewModel(application) {

    private val workManager = WorkManager.getInstance(application)
    private val workName = ExportWorker.WORK_NAME_PREFIX + projectId

    private val _state = MutableStateFlow(ExportUiState())
    val state: StateFlow<ExportUiState> = _state.asStateFlow()

    init {
        loadProject()
        observeWork()
    }

    private fun loadProject() {
        viewModelScope.launch {
            val database = ProjectDatabase.get(getApplication())
            val store = ProjectStore(getApplication(), database.projectDao())
            val project = store.load(projectId)?.project
            _state.value = _state.value.copy(
                duration = project?.duration ?: Ticks.ZERO,
                policy = DeviceProfile.read(getApplication()).effectivePolicy,
            )
        }
    }

    /**
     * Tracks the worker rather than holding the export in this scope.
     *
     * The point of running the export in WorkManager is that it outlives this
     * screen. Observing by unique work name means reopening the export screen
     * mid-render reattaches to the running job instead of starting a second one.
     */
    private fun observeWork() {
        viewModelScope.launch {
            workManager.getWorkInfosForUniqueWorkFlow(workName).collectLatest { infos ->
                val info = infos.lastOrNull() ?: return@collectLatest
                _state.value = _state.value.copy(progress = info.toProgress())
            }
        }
    }

    fun start(settings: ExportSettings) {
        val request = OneTimeWorkRequestBuilder<ExportWorker>()
            .setInputData(ExportWorker.inputData(projectId, settings))
            .build()

        // KEEP, not REPLACE: a second tap on Start while a render is running
        // should join the existing job, not throw away the work already done.
        workManager.enqueueUniqueWork(workName, ExistingWorkPolicy.KEEP, request)
        _state.value = _state.value.copy(progress = ExportProgress.Preparing)
    }

    fun cancel() {
        workManager.cancelUniqueWork(workName)
        _state.value = _state.value.copy(progress = ExportProgress.Cancelled)
    }
}

data class ExportUiState(
    val duration: Ticks = Ticks.ZERO,
    val policy: PerformancePolicy? = null,
    val progress: ExportProgress? = null,
)

private fun WorkInfo.toProgress(): ExportProgress? = when (state) {
    WorkInfo.State.ENQUEUED -> ExportProgress.Preparing
    WorkInfo.State.RUNNING -> ExportProgress.Running(progress.getInt(ExportWorker.KEY_PROGRESS, 0))
    WorkInfo.State.SUCCEEDED -> ExportProgress.Complete(
        outputUri = outputData.getString(ExportWorker.KEY_OUTPUT_URI).orEmpty(),
        sizeBytes = outputData.getLong(ExportWorker.KEY_OUTPUT_SIZE, 0L),
    )
    WorkInfo.State.FAILED -> ExportProgress.Failed(
        message = outputData.getString(ExportWorker.KEY_ERROR)
            ?: "The export could not be completed.",
        isRecoverable = true,
    )
    WorkInfo.State.CANCELLED -> ExportProgress.Cancelled
    WorkInfo.State.BLOCKED -> ExportProgress.Preparing
}

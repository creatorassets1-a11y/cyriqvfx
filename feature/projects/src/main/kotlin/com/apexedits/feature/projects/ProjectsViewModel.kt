package com.apexedits.feature.projects

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.apexedits.core.data.ProjectDatabase
import com.apexedits.core.data.ProjectEntity
import com.apexedits.core.data.ProjectStore
import com.apexedits.core.model.AspectRatio
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.FrameRate
import com.apexedits.core.model.ProjectFormat
import com.apexedits.core.model.createProject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class ProjectsViewModel(application: Application) : AndroidViewModel(application) {

    private val database = ProjectDatabase.get(application)
    private val store = ProjectStore(application, database.projectDao())

    val projects: StateFlow<List<ProjectEntity>> = store.observeProjects()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun createProject(
        name: String,
        aspect: AspectRatio,
        frameRate: FrameRate,
        onCreated: (String) -> Unit,
    ) {
        viewModelScope.launch {
            val now = System.currentTimeMillis()
            val project = createProject(
                ids = CountingIdSource(now),
                name = name,
                // 1080 on the short edge is the sensible default across every
                // shape: it is what the platforms want and what every phone can
                // encode. The user changes it at export, not here, because the
                // timeline resolution and the delivery resolution are different
                // decisions.
                format = ProjectFormat.of(aspect, height = shortEdgeHeight(aspect), frameRate = frameRate),
                nowEpochMs = now,
            )
            store.create(project)
            onCreated(project.id)
        }
    }

    fun delete(projectId: String) {
        viewModelScope.launch { store.delete(projectId) }
    }

    fun rename(projectId: String, name: String) {
        viewModelScope.launch { store.rename(projectId, name) }
    }
}

/**
 * The pixel height for a shape at 1080 on the short edge.
 *
 * A vertical project is 1080 wide and 1920 tall; a landscape one is 1920 by
 * 1080. Deriving from the short edge keeps both at the same effective quality
 * instead of making vertical projects a third the pixel count.
 */
private fun shortEdgeHeight(aspect: AspectRatio): Int =
    if (aspect.ratioWidth <= aspect.ratioHeight) {
        // Portrait or square: the width is the short edge, so scale the height up.
        (1080L * aspect.ratioHeight / aspect.ratioWidth).toInt().let { if (it % 2 == 0) it else it + 1 }
    } else {
        1080
    }

package com.apexedits.app

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.apexedits.core.designsystem.ApexEditsTheme
import com.apexedits.feature.editor.EditorScreen
import com.apexedits.feature.editor.EditorViewModel
import com.apexedits.feature.export.ExportScreen
import com.apexedits.feature.export.ExportViewModel
import com.apexedits.feature.projects.ProjectsScreen
import com.apexedits.feature.projects.ProjectsViewModel

/**
 * The app.
 *
 * There is no dependency-injection framework here on purpose. The graph is a
 * database, a store and three view models; Hilt would add a compiler plugin and
 * a set of version constraints to solve a problem this app does not have yet. If
 * the graph grows past what a factory can express clearly, that is the moment to
 * introduce one — not before.
 */
class ApexEditsApplication : Application()

/** Routes. String constants rather than a sealed type, to keep the nav graph flat and readable. */
object Routes {
    const val PROJECTS = "projects"
    const val EDITOR = "editor/{projectId}"
    const val EXPORT = "export/{projectId}"

    fun editor(projectId: String) = "editor/$projectId"
    fun export(projectId: String) = "export/$projectId"
}

@Composable
fun ApexEditsApp() {
    ApexEditsTheme {
        val navController = rememberNavController()

        NavHost(navController = navController, startDestination = Routes.PROJECTS) {

            composable(Routes.PROJECTS) {
                val application = androidx.compose.ui.platform.LocalContext.current
                    .applicationContext as Application
                val viewModel: ProjectsViewModel = viewModel(
                    factory = viewModelFactory { ProjectsViewModel(application) },
                )
                ProjectsScreen(
                    viewModel = viewModel,
                    onOpenProject = { navController.navigate(Routes.editor(it)) },
                )
            }

            composable(
                route = Routes.EDITOR,
                arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
            ) { entry ->
                val projectId = entry.arguments?.getString("projectId").orEmpty()
                val application = androidx.compose.ui.platform.LocalContext.current
                    .applicationContext as Application
                val viewModel: EditorViewModel = viewModel(
                    // Keyed by project id so opening a second project gets its
                    // own view model rather than inheriting the first one's
                    // document and undo stack.
                    key = "editor-$projectId",
                    factory = viewModelFactory { EditorViewModel(application, projectId) },
                )
                EditorScreen(
                    viewModel = viewModel,
                    onNavigateBack = { navController.popBackStack() },
                    onExport = { navController.navigate(Routes.export(projectId)) },
                )
            }

            composable(
                route = Routes.EXPORT,
                arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
            ) { entry ->
                val projectId = entry.arguments?.getString("projectId").orEmpty()
                val application = androidx.compose.ui.platform.LocalContext.current
                    .applicationContext as Application
                val viewModel: ExportViewModel = viewModel(
                    key = "export-$projectId",
                    factory = viewModelFactory { ExportViewModel(application, projectId) },
                )
                ExportScreen(viewModel = viewModel, onDone = { navController.popBackStack() })
            }
        }
    }
}

/** A one-off factory, so view models can take constructor arguments. */
private inline fun <reified T : ViewModel> viewModelFactory(crossinline create: () -> T) =
    object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <VM : ViewModel> create(modelClass: Class<VM>): VM = create() as VM
    }

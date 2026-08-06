package com.apexedit.editor

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.media3.common.util.UnstableApi
import com.apexedit.editor.ui.ApexTheme
import com.apexedit.editor.ui.EditorScreen
import com.apexedit.editor.vm.EditorViewModel

/**
 * Single-activity host.
 *
 * The editor is one screen with contextual panels rather than a navigation
 * stack: an editing session is continuous, and pushing a destination for every
 * tool would put a back-stack between the user and their timeline.
 */
@UnstableApi
class MainActivity : ComponentActivity() {

    private val viewModel: EditorViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ApexTheme {
                EditorScreen(viewModel)
            }
        }
    }

    override fun onStop() {
        super.onStop()
        // Never hold a decoder while backgrounded — the system will reclaim it
        // and playback comes back broken on resume.
        viewModel.preview.pause()
    }
}

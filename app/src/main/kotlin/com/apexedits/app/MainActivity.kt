package com.apexedits.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge

/**
 * The single activity.
 *
 * Edge-to-edge is enabled here and the insets are applied by `ApexScaffold`, so
 * the preview can use the full height of the screen while the system bars stay
 * out of the way of anything interactive.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { ApexEditsApp() }
    }
}

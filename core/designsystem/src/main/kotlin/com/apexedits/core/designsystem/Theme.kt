package com.apexedits.core.designsystem

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

/**
 * The theme.
 *
 * Dark-first, as the PRD asks: an editor is judged on the footage inside the
 * preview, and a bright chrome around it changes how the picture reads. The
 * surfaces are near-neutral charcoals rather than tinted greys for the same
 * reason — a blue-tinted panel makes a neutral grade look warm.
 *
 * Dynamic colour is deliberately not used. Material You would let the wallpaper
 * tint the surfaces around the video, which is the one place a video tool cannot
 * afford an uncontrolled colour cast.
 */

private val ApexAccent = Color(0xFF4DD6C1)
private val ApexAccentDark = Color(0xFF00897B)

private val DarkColors = darkColorScheme(
    primary = ApexAccent,
    onPrimary = Color(0xFF00201B),
    primaryContainer = Color(0xFF005048),
    onPrimaryContainer = Color(0xFF6FF7E1),
    secondary = Color(0xFFB0CCC6),
    onSecondary = Color(0xFF1B3531),
    secondaryContainer = Color(0xFF324B47),
    onSecondaryContainer = Color(0xFFCCE8E2),
    // Deep neutral charcoals: the preview sits on these, so they stay untinted.
    background = Color(0xFF0E0F0F),
    onBackground = Color(0xFFE1E3E1),
    surface = Color(0xFF141616),
    onSurface = Color(0xFFE1E3E1),
    surfaceVariant = Color(0xFF3F4947),
    onSurfaceVariant = Color(0xFFBEC9C6),
    outline = Color(0xFF889391),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
)

private val LightColors = lightColorScheme(
    primary = ApexAccentDark,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF6FF7E1),
    onPrimaryContainer = Color(0xFF00201B),
    secondary = Color(0xFF4A635E),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFCCE8E2),
    onSecondaryContainer = Color(0xFF05201C),
    background = Color(0xFFFAFDFB),
    onBackground = Color(0xFF191C1B),
    surface = Color(0xFFF3F5F3),
    onSurface = Color(0xFF191C1B),
    surfaceVariant = Color(0xFFDAE5E1),
    onSurfaceVariant = Color(0xFF3F4947),
    outline = Color(0xFF6F7977),
    error = Color(0xFFBA1A1A),
    onError = Color.White,
)

/**
 * Typography.
 *
 * Label styles carry generous line heights because they hold explanatory text
 * that has to stay readable when the system font scale is at 200%.
 */
private val ApexTypography = Typography(
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun ApexEditsTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            // Edge-to-edge: the app draws behind the system bars and
            // ApexScaffold insets the content, rather than the system reserving
            // space and stealing preview height.
            WindowCompat.getInsetsController(window, view)
                .isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = ApexTypography,
        content = content,
    )
}

package com.apexedit.editor.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Theme.
 *
 * Dark by default — an editor's job is to show footage honestly, and a bright
 * chrome around a video shifts how its exposure reads. Teal accent rather than
 * blue: at this surface luminance, blue sits too close to the system blue that
 * Android already uses for links and selection, and it disappears against sky
 * and water, which is a large share of what people shoot.
 */
object ApexColors {
    val Base = Color(0xFF07090D)
    val Panel = Color(0xFF0F1319)
    val Raised = Color(0xFF161B23)
    val Hover = Color(0xFF1E2530)
    val Border = Color(0xFF232C38)

    val TextPrimary = Color(0xFFEEF2F7)
    val TextSecondary = Color(0xFF9AA7B8)
    val TextTertiary = Color(0xFF6B7889)

    val Accent = Color(0xFF22E3C3)
    val AccentDim = Color(0xFF14B39C)
    val OnAccent = Color(0xFF04231F)

    val Danger = Color(0xFFFF5A5F)
    val Warning = Color(0xFFFFB443)
    val Record = Color(0xFFFF3B46)

    val TrackVideo = Color(0xFF2D6EF5)
    val TrackAudio = Color(0xFF23B07A)
    val TrackText = Color(0xFFB06EF5)

    /** Clip tags separated by luminance as well as hue, for colour-blind users. */
    val Tags = listOf(
        Color(0xFF4F8CFF),
        Color(0xFFFFB443),
        Color(0xFF22E3C3),
        Color(0xFFFF6FAE),
        Color(0xFFB48CFF),
    )
}

private val DarkScheme = darkColorScheme(
    primary = ApexColors.Accent,
    onPrimary = ApexColors.OnAccent,
    secondary = ApexColors.AccentDim,
    background = ApexColors.Base,
    onBackground = ApexColors.TextPrimary,
    surface = ApexColors.Panel,
    onSurface = ApexColors.TextPrimary,
    surfaceVariant = ApexColors.Raised,
    onSurfaceVariant = ApexColors.TextSecondary,
    outline = ApexColors.Border,
    error = ApexColors.Danger,
)

private val LightScheme = lightColorScheme(
    primary = Color(0xFF06A68C),
    onPrimary = Color.White,
    background = Color(0xFFF4F6F9),
    onBackground = Color(0xFF101720),
    surface = Color.White,
    onSurface = Color(0xFF101720),
    surfaceVariant = Color(0xFFF0F3F7),
    onSurfaceVariant = Color(0xFF4B5666),
    outline = Color(0xFFDFE5ED),
    error = Color(0xFFD1343A),
)

/**
 * Type scale. Deliberately compact: an editor is dense, and Material's defaults
 * waste vertical space that the timeline needs. Nothing goes below 11sp, which
 * is the floor for legibility at arm's length on a phone.
 */
private val ApexTypography = Typography(
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
    bodyMedium = TextStyle(fontSize = 14.sp),
    bodySmall = TextStyle(fontSize = 12.sp),
    labelLarge = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium),
)

/** Layout constants used across the editor. */
object Dimens {
    /** Android's documented minimum touch target. Nothing tappable is smaller. */
    val TouchMin = 48.dp
    val ToolbarHeight = 72.dp
    val TrackHeight = 56.dp
    val AudioTrackHeight = 40.dp
    val RulerHeight = 28.dp
    val TransportHeight = 56.dp
    val PanelMaxHeightFraction = 0.55f

    val SpaceXs = 4.dp
    val SpaceS = 8.dp
    val SpaceM = 12.dp
    val SpaceL = 16.dp
    val SpaceXl = 24.dp

    val RadiusS = 6.dp
    val RadiusM = 10.dp
    val RadiusL = 16.dp
}

@Composable
fun ApexTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else LightScheme,
        typography = ApexTypography,
        content = content,
    )
}

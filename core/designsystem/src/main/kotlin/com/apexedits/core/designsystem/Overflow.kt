package com.apexedits.core.designsystem

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The zero-overflow machinery.
 *
 * The PRD's hardest UI requirement is that nothing is ever clipped or pushed
 * off-screen on any device, orientation, or font scale. Written as a rule it
 * survives exactly as long as the next person who adds a `height(320.dp)` to a
 * panel. So it is enforced two ways instead:
 *
 *  - **Structurally.** [ApexScaffold] is the only screen container and it always
 *    applies safe-area insets. Sizes derive from [BoxWithConstraints] fractions,
 *    never from constants, so a layout that fits a 4.5" phone also fits a
 *    foldable without a second code path.
 *
 *  - **By assertion.** [overflowSentinel] compares what a composable actually
 *    measured against the space it was given, and fails the build's UI tests
 *    when it does not fit. Overflow becomes a red test rather than something a
 *    reviewer has to spot in a screenshot.
 */

/** Thrown by [overflowSentinel] in debug builds. Caught by nothing: it is a bug. */
class OverflowException(message: String) : IllegalStateException(message)

/**
 * Reports when the content measures larger than the constraints it was handed.
 *
 * [tag] names the region so a failure says *which* part overflowed rather than
 * just that something did.
 *
 * [strict] governs what happens on a violation. UI tests run with it on and get
 * a hard failure; production runs with it off and calls [onOverflow] so the
 * layout degrades rather than taking the session down. A user mid-edit is not
 * served by a crash over a few clipped pixels.
 */
fun Modifier.overflowSentinel(
    tag: String,
    strict: Boolean = OverflowPolicy.strict,
    onOverflow: (String) -> Unit = OverflowPolicy.reporter,
): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    val overflowsWidth = constraints.hasBoundedWidth && placeable.width > constraints.maxWidth
    val overflowsHeight = constraints.hasBoundedHeight && placeable.height > constraints.maxHeight

    if (overflowsWidth || overflowsHeight) {
        val message = buildString {
            append("Layout overflow in '").append(tag).append("': measured ")
            append(placeable.width).append("x").append(placeable.height)
            append(" but was given at most ")
            append(if (constraints.hasBoundedWidth) constraints.maxWidth.toString() else "∞")
            append("x")
            append(if (constraints.hasBoundedHeight) constraints.maxHeight.toString() else "∞")
        }
        if (strict) throw OverflowException(message) else onOverflow(message)
    }

    // Place within the constraints regardless, so a violation in production is
    // a clipped pixel rather than a composable drawn outside its parent.
    val width = placeable.width.coerceAtMost(
        if (constraints.hasBoundedWidth) constraints.maxWidth else placeable.width,
    )
    val height = placeable.height.coerceAtMost(
        if (constraints.hasBoundedHeight) constraints.maxHeight else placeable.height,
    )
    layout(width, height) { placeable.placeRelative(0, 0) }
}

/**
 * Global switch for the sentinel. UI tests set [strict] before composing; the
 * app leaves it off and routes reports to the log.
 */
object OverflowPolicy {
    @Volatile
    var strict: Boolean = false

    @Volatile
    var reporter: (String) -> Unit = { message -> android.util.Log.e("ApexEdits", message) }
}

/**
 * The only screen container.
 *
 * Applies safe-drawing insets — status bar, navigation bar, display cutout,
 * IME — and clips to its own bounds, so no screen can opt out of respecting a
 * notch or a gesture bar. Content receives a [BoxWithConstraintsScope]-derived
 * size through [content] so children size themselves in fractions of what is
 * actually available.
 */
@Composable
fun ApexScaffold(
    tag: String,
    modifier: Modifier = Modifier,
    applySafeInsets: Boolean = true,
    content: @Composable BoxScope.(availableWidth: Dp, availableHeight: Dp) -> Unit,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .then(if (applySafeInsets) Modifier.safeDrawingPadding() else Modifier)
            .clipToBounds()
            .overflowSentinel(tag),
    ) {
        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            content(maxWidth, maxHeight)
        }
    }
}

/**
 * Screen size buckets, used to choose between the phone layout and the
 * two-pane tablet/foldable one.
 *
 * The thresholds match the Material window size classes rather than inventing
 * new ones, so the app agrees with the platform about what "medium" means.
 */
enum class ApexWidthClass { COMPACT, MEDIUM, EXPANDED;

    companion object {
        fun of(width: Dp): ApexWidthClass = when {
            width < 600.dp -> COMPACT
            width < 840.dp -> MEDIUM
            else -> EXPANDED
        }
    }
}

enum class ApexHeightClass { COMPACT, MEDIUM, EXPANDED;

    companion object {
        fun of(height: Dp): ApexHeightClass = when {
            height < 480.dp -> COMPACT
            height < 900.dp -> MEDIUM
            else -> EXPANDED
        }
    }
}

/** Constraints with the height bound removed. For measuring intrinsic content. */
internal fun Constraints.withUnboundedHeight(): Constraints = copy(maxHeight = Constraints.Infinity)

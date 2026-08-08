package com.apexedits.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * The control library.
 *
 * The PRD's rule is that no interactive element may be an unexplained icon:
 * every one needs a visible label *or* a long-press tooltip, plus a full
 * accessibility description saying what it does and what happens when it is
 * used.
 *
 * A rule like that written in a style guide gets followed for a month. So this
 * library simply does not offer a way to break it. There is no icon-only button
 * to reach for: [ApexToolButton] takes `label`, `tooltip` and `description` as
 * required non-null parameters and wires the tooltip and the semantics itself.
 * Forgetting one is a compile error, not a review comment.
 *
 * The 48 dp minimum touch target is likewise a default inside the component
 * rather than a number each call site has to remember.
 */

/**
 * The PRD's minimum touch target. [PreferredToolSize] used to default to 56
 * dp — comfortably above the floor, but visibly bulkier on screen than the
 * mobile NLEs this app is meant to feel like, which sit at or close to the
 * 48 dp minimum itself. Matching that keeps the toolbar dense without
 * dropping below the accessibility requirement.
 */
val MinTouchTarget = 48.dp
val PreferredToolSize = 48.dp

/**
 * A tool button: icon, always-visible label, long-press tooltip, full semantics.
 *
 * @param label short text shown under the icon — "Split", "Delete"
 * @param tooltip the plain-language explanation shown on long press, written for
 *   someone who has never edited video: "Cuts the selected clip into two
 *   separate pieces at the playhead position."
 * @param description the complete TalkBack description, stating both the action
 *   and its result
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApexToolButton(
    icon: ImageVector,
    label: String,
    tooltip: String,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    selected: Boolean = false,
    /** Shown instead of the tooltip when disabled, saying why. */
    disabledReason: String? = null,
) {
    val tooltipState = rememberTooltipState()
    val effectiveTooltip = if (!enabled && disabledReason != null) disabledReason else tooltip
    val effectiveDescription = if (!enabled && disabledReason != null) {
        "$description Currently unavailable: $disabledReason"
    } else {
        description
    }

    TooltipBox(
        positionProvider = TooltipDefaults.rememberTooltipPositionProvider(),
        tooltip = {
            PlainTooltip(modifier = Modifier.widthIn(max = 260.dp)) {
                Text(text = effectiveTooltip, style = MaterialTheme.typography.bodySmall)
            }
        },
        state = tooltipState,
    ) {
        Surface(
            onClick = onClick,
            enabled = enabled,
            shape = RoundedCornerShape(12.dp),
            color = if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
            contentColor = when {
                !enabled -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                selected -> MaterialTheme.colorScheme.onSecondaryContainer
                else -> MaterialTheme.colorScheme.onSurface
            },
            modifier = modifier
                .sizeIn(minWidth = MinTouchTarget, minHeight = MinTouchTarget)
                .defaultMinSize(minWidth = PreferredToolSize)
                .semantics {
                    contentDescription = effectiveDescription
                    if (selected) stateDescription = "Active"
                },
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
            ) {
                Icon(
                    imageVector = icon,
                    // The label and the semantics carry the meaning; repeating
                    // it on the icon would make TalkBack say everything twice.
                    contentDescription = null,
                    modifier = Modifier.sizeIn(minWidth = 20.dp, minHeight = 20.dp),
                )
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelSmall,
                    // Two lines, so a long label at 200% font scale wraps
                    // instead of pushing the row off the screen.
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 1.dp).widthIn(max = 76.dp),
                )
            }
        }
    }
}

/**
 * A horizontally scrolling row of tools.
 *
 * Lazy and scrollable by construction, so adding a tool can never push the last
 * one off the edge — the row scrolls instead of clipping. This is why the PRD's
 * "maximum 6–8 visible tools" is a comfort target rather than a hard limit that
 * breaks when a device is narrow or the font is large.
 */
@Composable
fun ApexToolRow(
    modifier: Modifier = Modifier,
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    LazyRow(
        modifier = modifier.fillMaxWidth().overflowSentinel("ApexToolRow"),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/**
 * A labelled slider.
 *
 * [explanation] is the plain-language description of what the value does —
 * "Make the image warmer (orange) or cooler (blue)" — shown under the label and
 * read by TalkBack. [valueLabel] formats the current value for display, because
 * a slider with no number is unusable for precise work.
 */
@Composable
fun ApexSlider(
    label: String,
    explanation: String,
    value: Float,
    onValueChange: (Float) -> Unit,
    valueRange: ClosedFloatingPointRange<Float>,
    valueLabel: (Float) -> String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onValueChangeFinished: (() -> Unit)? = null,
) {
    Column(modifier = modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Text(
                text = valueLabel(value),
                style = MaterialTheme.typography.labelMedium,
                color = LocalContentColor.current.copy(alpha = 0.7f),
                maxLines = 1,
            )
        }
        Text(
            text = explanation,
            style = MaterialTheme.typography.bodySmall,
            color = LocalContentColor.current.copy(alpha = 0.7f),
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        Slider(
            value = value,
            onValueChange = onValueChange,
            onValueChangeFinished = onValueChangeFinished,
            valueRange = valueRange,
            enabled = enabled,
            modifier = Modifier
                .fillMaxWidth()
                .sizeIn(minHeight = MinTouchTarget)
                .semantics {
                    contentDescription = "$label. $explanation"
                    stateDescription = valueLabel(value)
                },
        )
    }
}

/**
 * A labelled toggle.
 *
 * [onExplanation] and [offExplanation] describe what each state *means* rather
 * than naming the setting twice — the PRD's snap toggle reads "When on, clips
 * automatically align to other clips, markers, and the playhead for clean edits"
 * instead of "Snap: on".
 */
@Composable
fun ApexToggle(
    label: String,
    onExplanation: String,
    offExplanation: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val explanation = if (checked) onExplanation else offExplanation
    Row(
        modifier = modifier
            .fillMaxWidth()
            .sizeIn(minHeight = MinTouchTarget)
            .padding(vertical = 4.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = "$label. $explanation"
                stateDescription = if (checked) "On" else "Off"
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(text = label, style = MaterialTheme.typography.labelLarge, maxLines = 2)
            Text(
                text = explanation,
                style = MaterialTheme.typography.bodySmall,
                color = LocalContentColor.current.copy(alpha = 0.7f),
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
    }
}

/**
 * A panel header.
 *
 * [title] names the panel and [purpose] says what is inside it, matching the
 * PRD's required form: "Colour & Light — Adjust brightness, contrast, colour
 * temperature, and advanced grading."
 */
@Composable
fun ApexPanelHeader(
    title: String,
    purpose: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics(mergeDescendants = true) { contentDescription = "$title. $purpose" },
    ) {
        Text(text = title, style = MaterialTheme.typography.titleMedium, maxLines = 2)
        Text(
            text = purpose,
            style = MaterialTheme.typography.bodySmall,
            color = LocalContentColor.current.copy(alpha = 0.75f),
            maxLines = 4,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * A track header toggle — lock, mute, solo, visibility.
 *
 * Small enough to sit in a track header, but still carries a full tooltip and
 * description, because these are exactly the controls a new user cannot guess
 * from an icon.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApexTrackToggle(
    icon: ImageVector,
    label: String,
    tooltip: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tooltipState = rememberTooltipState()
    TooltipBox(
        positionProvider = TooltipDefaults.rememberTooltipPositionProvider(),
        tooltip = {
            PlainTooltip(modifier = Modifier.widthIn(max = 260.dp)) {
                Text(text = tooltip, style = MaterialTheme.typography.bodySmall)
            }
        },
        state = tooltipState,
    ) {
        Surface(
            onClick = { onCheckedChange(!checked) },
            shape = RoundedCornerShape(8.dp),
            color = if (checked) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
            contentColor = if (checked) {
                MaterialTheme.colorScheme.onSecondaryContainer
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = modifier
                .sizeIn(minWidth = MinTouchTarget, minHeight = MinTouchTarget)
                .semantics {
                    contentDescription = description
                    stateDescription = if (checked) "On" else "Off"
                },
        ) {
            Row(
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(6.dp),
            ) {
                Icon(imageVector = icon, contentDescription = null, modifier = Modifier.sizeIn(minWidth = 18.dp, minHeight = 18.dp))
            }
        }
    }
    // `label` is intentionally unused for drawing: the track header is too
    // narrow for text. It is required by the signature so the caller has to
    // name the control, and it feeds the string-resource audit.
    remember(label) { label }
}

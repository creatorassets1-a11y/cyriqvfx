package com.apexedits.core.designsystem

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The audit that keeps the PRD's labelling rule true.
 *
 * The rule — every control carries a label, a plain-language tooltip, and a full
 * accessibility description — is enforced at compile time by [ApexToolButton]'s
 * signature: you cannot construct one without all three. But nothing in the type
 * system stops someone passing `""`, or writing a tooltip that just repeats the
 * label, or shipping a control whose description says "Opens the FX panel".
 *
 * So this reads the string catalogue as data and checks the copy itself. It runs
 * as a plain JVM unit test parsing the XML directly, which means no emulator and
 * no Robolectric — it costs milliseconds, so it can run on every build.
 */
class ToolCopyAuditTest {

    private val strings: Map<String, String> by lazy { readStrings() }

    private fun readStrings(): Map<String, String> {
        // Resolved relative to the module directory, which is Gradle's working
        // directory for the test task.
        val file = File("src/main/res/values/strings.xml")
        assertTrue("Cannot find ${file.absolutePath}", file.exists())

        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val nodes = document.getElementsByTagName("string")
        return buildMap {
            for (index in 0 until nodes.length) {
                val node = nodes.item(index)
                val name = node.attributes.getNamedItem("name")?.nodeValue ?: continue
                put(name, node.textContent.orEmpty().replace("\\'", "'").trim())
            }
        }
    }

    /** Every `tool_*` id that has at least one of the three strings. */
    private fun toolIds(): Set<String> =
        strings.keys
            .filter { it.startsWith("tool_") }
            .mapNotNull { key ->
                SUFFIXES.firstOrNull { key.endsWith("_$it") }?.let { suffix ->
                    key.removePrefix("tool_").removeSuffix("_$suffix")
                }
            }
            .toSet()

    @Test
    fun `every tool has a label, a tooltip and a description`() {
        val missing = mutableListOf<String>()
        for (id in toolIds()) {
            for (suffix in SUFFIXES) {
                val key = "tool_${id}_$suffix"
                if (strings[key].isNullOrBlank()) missing += key
            }
        }
        if (missing.isNotEmpty()) {
            fail(
                "These tool strings are missing or blank, so a control would ship " +
                    "without an explanation:\n  " + missing.sorted().joinToString("\n  "),
            )
        }
    }

    @Test
    fun `the catalogue is not empty`() {
        // Guards against the audit silently passing because the file moved and
        // the parse returned nothing.
        assertTrue("Expected a populated tool catalogue", toolIds().size >= 20)
    }

    @Test
    fun `no label uses a word that explains nothing`() {
        // The PRD names these explicitly: "Never use vague names like Tool, FX,
        // More, or icon-only without explanation."
        val offenders = toolIds().mapNotNull { id ->
            val label = strings["tool_${id}_label"].orEmpty()
            if (label.lowercase() in BANNED_LABELS) "tool_${id}_label = \"$label\"" else null
        }
        assertEquals("Vague labels tell the user nothing: $offenders", emptyList<String>(), offenders)
    }

    @Test
    fun `descriptions are long enough to actually describe something`() {
        // A description that fits in a couple of words is a label wearing a
        // different name. TalkBack users get the label already.
        val tooShort = toolIds().mapNotNull { id ->
            val key = "tool_${id}_description"
            val value = strings[key].orEmpty()
            if (value.length < 40) "$key (${value.length} chars)" else null
        }
        assertEquals("Descriptions too short to explain the action: $tooShort", emptyList<String>(), tooShort)
    }

    @Test
    fun `tooltips explain rather than restate the label`() {
        val lazy = toolIds().mapNotNull { id ->
            val label = strings["tool_${id}_label"].orEmpty()
            val tooltip = strings["tool_${id}_tooltip"].orEmpty()
            when {
                tooltip.length < 30 -> "tool_${id}_tooltip is only ${tooltip.length} chars"
                tooltip.equals(label, ignoreCase = true) -> "tool_${id}_tooltip just repeats the label"
                else -> null
            }
        }
        assertEquals("Tooltips must explain the action in plain language: $lazy", emptyList<String>(), lazy)
    }

    @Test
    fun `descriptions say what happens, not just what the control is called`() {
        // A description should contain a verb phrase about the user's video. The
        // cheap proxy: it must be a sentence, and it must not simply be the
        // label with a full stop.
        val weak = toolIds().mapNotNull { id ->
            val label = strings["tool_${id}_label"].orEmpty()
            val description = strings["tool_${id}_description"].orEmpty()
            when {
                !description.trimEnd().endsWith(".") -> "tool_${id}_description is not a sentence"
                description.removeSuffix(".").equals(label, ignoreCase = true) ->
                    "tool_${id}_description restates the label"
                else -> null
            }
        }
        assertEquals("Weak descriptions: $weak", emptyList<String>(), weak)
    }

    private companion object {
        val SUFFIXES = listOf("label", "tooltip", "description")
        val BANNED_LABELS = setOf("tool", "tools", "fx", "more", "options", "misc", "other", "advanced")
    }
}

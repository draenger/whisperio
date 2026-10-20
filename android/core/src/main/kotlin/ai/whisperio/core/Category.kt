package ai.whisperio.core

/**
 * CONTRACT-1.2 F3. A category is identified by [id]: a seed id ([Categories.SEED_IDS]) or `c_` + UUID for a custom one.
 * [hueIndex] is the stored slot of a custom category (creation order); seeds ignore it.
 */
data class CategoryDef(val id: String, val custom: Boolean, val hueIndex: Int)

object Categories {
    /** iOS `Categories.swift` order. */
    val SEED_IDS: List<String> = listOf("work", "personal", "ideas", "messages", "code", "todo")

    /** iOS `customHueCycle`, as 0xRRGGBB (no alpha: the UI adds 0xFF000000). */
    private val CUSTOM_HUES: LongArray = longArrayOf(0x4A8CF7L, 0xFBBF24L, 0xF472B6L, 0xA78BFAL, 0x34D399L, 0x22D3EEL)

    const val CUSTOM_PREFIX = "c_"

    /** Colour of the custom category with stored slot [index]: `index % 6`, negative indexes wrap too. */
    fun customHue(index: Int): Long = CUSTOM_HUES[Math.floorMod(index, CUSTOM_HUES.size)]

    fun isSeed(id: String?): Boolean = id != null && id in SEED_IDS
}

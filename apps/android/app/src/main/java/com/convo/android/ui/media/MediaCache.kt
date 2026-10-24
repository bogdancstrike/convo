package com.convo.android.ui.media

import android.content.Context
import java.io.File
import java.security.MessageDigest

/**
 * Decrypted attachments in Convo's app-private storage (not readable by other apps), so media that
 * was auto-downloaded or opened once is not fetched and decrypted again. Bounded to [maxBytes];
 * the least recently used files are evicted first. Cleared on logout.
 *
 * File names are a hash of the attachment ID, so the directory listing reveals nothing about chats.
 */
class MediaCache(context: Context, private val maxBytes: Long = 256L * 1024 * 1024) {
    private val dir = File(context.filesDir, "media-cache").apply { mkdirs() }

    private fun fileOf(attachmentId: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(attachmentId.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir, hash)
    }

    /** Cached plaintext, marking it recently used; null when absent. */
    @Synchronized fun get(attachmentId: String): ByteArray? {
        if (attachmentId.isBlank()) return null
        val file = fileOf(attachmentId)
        if (!file.isFile) return null
        file.setLastModified(System.currentTimeMillis())
        return runCatching { file.readBytes() }.getOrNull()
    }

    @Synchronized fun contains(attachmentId: String): Boolean = attachmentId.isNotBlank() && fileOf(attachmentId).isFile

    /** Stores plaintext (skipped when larger than a quarter of the budget), then trims to the bound. */
    @Synchronized fun put(attachmentId: String, bytes: ByteArray) {
        if (attachmentId.isBlank() || bytes.size > maxBytes / 4) return
        val target = fileOf(attachmentId)
        val partial = File(dir, target.name + ".part")
        runCatching { partial.writeBytes(bytes); partial.renameTo(target) }.onFailure { partial.delete() }
        trim()
    }

    @Synchronized fun clear() { dir.listFiles()?.forEach { it.delete() } }

    private fun trim() {
        val files = dir.listFiles()?.filter { it.isFile }?.sortedBy { it.lastModified() } ?: return
        var total = files.sumOf { it.length() }
        for (file in files) { if (total <= maxBytes) break; total -= file.length(); file.delete() }
    }
}

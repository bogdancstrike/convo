package com.convo.android.ui.thread

import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.i18n.*
import com.convo.android.ui.theme.*
import com.convo.android.i18n.Text
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.security.MessageDigest
import org.json.JSONObject

/**
 * Bundled stickers (AC-MED-04). The pack manifest (IDs, alt text, SHA-256) comes from the shared core
 * (`core/stickers.ts`); the files ship in the APK under `assets/stickers`. A file is decoded only
 * when its size and SHA-256 match the manifest, so an altered file shows a placeholder instead.
 */
object Stickers {
    private const val MAX_BYTES = 128 * 1024
    private val cache = mutableMapOf<String, ImageBitmap?>()
    /** Packs from the core, loaded once per process. */
    var packs by mutableStateOf<List<JSONObject>>(emptyList())

    fun load(app: MainActivity) { if (packs.isEmpty()) app.call("stickerPacks", quiet = true) { v -> (v as? org.json.JSONArray)?.let { packs = it.objects() } } }

    fun find(pack: String, id: String): JSONObject? =
        packs.find { it.optString("id") == pack }?.optJSONArray("stickers")?.objects()?.find { it.optString("id") == id }

    /** Verified bytes of a bundled sticker, or null when unknown, missing or altered. */
    fun verifiedBytes(app: MainActivity, pack: String, id: String): ByteArray? {
        val sticker = find(pack, id) ?: return null
        val bytes = runCatching { app.assets.open("stickers/$pack/$id.webp").use { it.readBytes() } }.getOrNull() ?: return null
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { b -> "%02x".format(b) }
        return if (bytes.size > MAX_BYTES || hash != sticker.optString("sha256")) null else bytes
    }

    fun animated(pack: String) = packs.find { it.optString("id") == pack }?.optBoolean("animated") == true

    /** Reduced motion: system animations off, or Convo's Animations setting off. */
    fun motionReduced(app: MainActivity): Boolean =
        android.provider.Settings.Global.getFloat(app.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f ||
            app.snapshot.optJSONObject("settings")?.optBoolean("animations", true) == false

    /** First frame (static packs, or animated ones under reduced motion). */
    @Synchronized fun bitmap(app: MainActivity, pack: String, id: String): ImageBitmap? = cache.getOrPut("$pack/$id") {
        if (find(pack, id) == null) return null // manifest not loaded yet: retry later
        verifiedBytes(app, pack, id)?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }
    }
}

/** One sticker, or a placeholder with its emoji when unknown or altered. */
@Composable fun StickerImage(app: MainActivity, pack: String, id: String, size: Dp = 150.dp) {
    LaunchedEffect(Unit) { Stickers.load(app) }
    val sticker = Stickers.find(pack, id)
    val image = remember(pack, id, Stickers.packs) { Stickers.bitmap(app, pack, id) }
    val alt = sticker?.let { tr("Sticker: {name}").replace("{name}", it.optString("alt")) } ?: tr("Sticker")
    // Animated packs play (ImageDecoder → AnimatedImageDrawable) unless motion is reduced.
    val animatedBytes = remember(pack, id, Stickers.packs) { if (Stickers.animated(pack) && !Stickers.motionReduced(app)) Stickers.verifiedBytes(app, pack, id) else null }
    if (animatedBytes != null) androidx.compose.ui.viewinterop.AndroidView(factory = { context ->
        android.widget.ImageView(context).apply {
            contentDescription = alt
            val drawable = android.graphics.ImageDecoder.decodeDrawable(android.graphics.ImageDecoder.createSource(java.nio.ByteBuffer.wrap(animatedBytes)))
            setImageDrawable(drawable)
            (drawable as? android.graphics.drawable.AnimatedImageDrawable)?.start()
        }
    }, modifier = Modifier.size(size))
    else if (image != null) Image(image, alt, Modifier.size(size))
    else Box(Modifier.size(size).clip(RoundedCornerShape(16.dp)).background(LocalConvoColors.current.panel).semantics { contentDescription = alt }, contentAlignment = Alignment.Center) {
        RawText(sticker?.optString("emoji") ?: "🏷️", fontSize = 44.sp)
    }
}

/** Sticker picker sheet: the bundled packs as a grid; tapping sends. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun StickerSheet(app: MainActivity, conversation: String, topic: String?, close: () -> Unit) {
    LaunchedEffect(Unit) { Stickers.load(app) }
    ModalBottomSheet(onDismissRequest = close) {
        Column(Modifier.padding(horizontal = 12.dp).padding(bottom = 24.dp)) {
            Text("Stickers", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
            Stickers.packs.forEach { pack ->
                RawText(pack.optString("title"), style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(4.dp))
                LazyVerticalGrid(GridCells.Adaptive(80.dp), Modifier.heightIn(max = 420.dp)) {
                    items(pack.optJSONArray("stickers")?.objects().orEmpty(), key = { it.optString("id") }) { s ->
                        Box(Modifier.padding(4.dp).clip(RoundedCornerShape(10.dp)).clickable {
                            close(); app.call("sendSticker", obj("conversationId" to conversation, "pack" to pack.optString("id"), "id" to s.optString("id"), "topic" to topic))
                        }.padding(4.dp), contentAlignment = Alignment.Center) { StickerImage(app, pack.optString("id"), s.optString("id"), 72.dp) }
                    }
                }
            }
        }
    }
}

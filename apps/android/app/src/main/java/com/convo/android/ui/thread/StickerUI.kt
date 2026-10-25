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
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.layout.PaddingValues
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

    // --- personal stickers (WhatsApp: create, save, favourites; synced across own devices) ---

    /** Custom pack ID used by the core for personal stickers. */
    const val CUSTOM = "custom"
    /** The account's collection from the core: `custom` [{id, pointer}], `favorites` [{pack, id}]. */
    var collection by mutableStateOf(JSONObject())
    private val customBytes = mutableMapOf<String, ByteArray>()

    fun loadCollection(app: MainActivity) { app.call("stickerCollection", quiet = true) { v -> (v as? JSONObject)?.let { collection = it } } }
    fun custom(): List<JSONObject> = collection.optJSONArray("custom")?.objects().orEmpty()
    fun favorites(): List<JSONObject> = collection.optJSONArray("favorites")?.objects().orEmpty()
    fun isFavorite(pack: String, id: String) = favorites().any { it.optString("pack") == pack && it.optString("id") == id }
    fun isSaved(id: String) = custom().any { it.optString("id") == id }

    /** Verified bytes of a personal sticker (the core checks SHA-256 = ID); cached per process. */
    fun customBytes(app: MainActivity, id: String, attachment: JSONObject?, then: (ByteArray?) -> Unit) {
        synchronized(customBytes) { customBytes[id] }?.let { then(it); return }
        app.call("stickerBytes", obj("id" to id, "attachment" to attachment), quiet = true) { v ->
            val bytes = (v as? String)?.let { app.decode(it) }
            if (bytes != null) synchronized(customBytes) { customBytes[id] = bytes }
            then(bytes)
        }
    }

    /** First frame (static packs, or animated ones under reduced motion). */
    @Synchronized fun bitmap(app: MainActivity, pack: String, id: String): ImageBitmap? = cache.getOrPut("$pack/$id") {
        if (find(pack, id) == null) return null // manifest not loaded yet: retry later
        verifiedBytes(app, pack, id)?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }
    }
}

/** One sticker, or a placeholder with its emoji when unknown or altered. */
@Composable fun StickerImage(app: MainActivity, pack: String, id: String, size: Dp = 150.dp, attachment: JSONObject? = null) {
    if (pack == Stickers.CUSTOM) { CustomStickerImage(app, id, attachment, size); return }
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

/** A personal sticker: decrypted, SHA-256-verified bytes from the core; a placeholder until loaded. */
@Composable fun CustomStickerImage(app: MainActivity, id: String, attachment: JSONObject?, size: Dp) {
    var image by remember(id) { mutableStateOf<ImageBitmap?>(null) }
    var missing by remember(id) { mutableStateOf(false) }
    LaunchedEffect(id) { Stickers.customBytes(app, id, attachment) { bytes -> val decoded = bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }; app.runOnUiThread { image = decoded; missing = decoded == null } } }
    val alt = tr("Sticker")
    image?.let { Image(it, alt, Modifier.size(size)) }
        ?: Box(Modifier.size(size).clip(RoundedCornerShape(16.dp)).background(LocalConvoColors.current.panel).semantics { contentDescription = alt }, contentAlignment = Alignment.Center) {
            if (missing) RawText("🏷️", fontSize = 44.sp) else CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
        }
}

/**
 * Sticker picker sheet (WhatsApp): Favourites, My stickers (with "Create" from a photo) and the
 * bundled packs. Tapping sends; long-pressing offers favourite / remove.
 */
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable fun StickerSheet(app: MainActivity, conversation: String, topic: String?, close: () -> Unit) {
    LaunchedEffect(Unit) { Stickers.load(app); Stickers.loadCollection(app) }
    var creating by remember { mutableStateOf(false) }
    var options by remember { mutableStateOf<Pair<String, String>?>(null) }
    fun send(pack: String, id: String) { close(); app.call("sendSticker", obj("conversationId" to conversation, "pack" to pack, "id" to id, "topic" to topic)) }
    fun create() = app.pickFile({ data, _, type ->
        creating = true
        app.call("createSticker", obj("data" to data, "mime" to type)) { v -> creating = false; if (v != null) { Stickers.loadCollection(app); app.notice = tr("Sticker added to My stickers") } }
    }, "image/*")
    @Composable fun tile(pack: String, id: String) = Box(Modifier.padding(4.dp).clip(RoundedCornerShape(10.dp))
        .combinedClickable(onLongClickLabel = tr("Sticker options"), onLongClick = { options = pack to id }) { send(pack, id) }.padding(4.dp), contentAlignment = Alignment.Center) {
        StickerImage(app, pack, id, 72.dp)
        DropdownMenu(options == pack to id, { options = null }) {
            DropdownMenuItem(text = { Text(if (Stickers.isFavorite(pack, id)) "Remove from favourites" else "Add to favourites") }, onClick = {
                options = null; app.call("favoriteSticker", obj("pack" to pack, "id" to id)) { Stickers.loadCollection(app) }
            })
            if (pack == Stickers.CUSTOM) DropdownMenuItem(text = { Text("Remove from My stickers") }, onClick = {
                options = null; app.call("removeSticker", obj("id" to id)) { Stickers.loadCollection(app) }
            })
        }
    }
    ModalBottomSheet(onDismissRequest = close) {
        LazyVerticalGrid(GridCells.Adaptive(80.dp), Modifier.heightIn(max = 520.dp).padding(horizontal = 12.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            fun header(title: String) = item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                Text(title, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(4.dp))
            }
            val favorites = Stickers.favorites()
            if (favorites.isNotEmpty()) { header("Favourites"); items(favorites, key = { "fav:${it.optString("pack")}/${it.optString("id")}" }) { tile(it.optString("pack"), it.optString("id")) } }
            header("My stickers")
            item(key = "create") {
                Box(Modifier.padding(4.dp).size(80.dp).clip(RoundedCornerShape(10.dp)).background(LocalConvoColors.current.panel).clickable(enabled = !creating) { create() }, contentAlignment = Alignment.Center) {
                    if (creating) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                    else Column(horizontalAlignment = Alignment.CenterHorizontally) { RawText("+", fontSize = 28.sp); Text("Create", fontSize = 12.sp) }
                }
            }
            items(Stickers.custom(), key = { "my:${it.optString("id")}" }) { tile(Stickers.CUSTOM, it.optString("id")) }
            Stickers.packs.forEach { pack ->
                header(pack.optString("title"))
                items(pack.optJSONArray("stickers")?.objects().orEmpty(), key = { "${pack.optString("id")}/${it.optString("id")}" }) { tile(pack.optString("id"), it.optString("id")) }
            }
        }
    }
}

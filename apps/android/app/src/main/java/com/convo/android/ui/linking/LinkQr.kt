package com.convo.android.ui.linking

import com.convo.android.R
import com.convo.android.BuildConfig
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.calls.*
import com.convo.android.i18n.*
import com.convo.android.push.*
import com.convo.android.ui.communities.*
import com.convo.android.ui.contacts.*
import com.convo.android.ui.info.*
import com.convo.android.ui.locks.*
import com.convo.android.ui.media.*
import com.convo.android.ui.settings.*
import com.convo.android.ui.theme.*
import com.convo.android.ui.thread.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import org.json.JSONObject

/** Same payload as the web client: `convo-link:<digits>` (a comparison code, not a secret). */
const val LINK_QR_PREFIX = "convo-link:"

@Composable fun LinkQr(code: String) {
    val bitmap = remember(code) {
        val matrix = QRCodeWriter().encode(LINK_QR_PREFIX + code.filter(Char::isDigit), BarcodeFormat.QR_CODE, 512, 512, mapOf(EncodeHintType.MARGIN to 1))
        Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.RGB_565).apply {
            for (x in 0 until matrix.width) for (y in 0 until matrix.height) setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }.asImageBitmap()
    }
    Image(bitmap, tr("QR code with the comparison code"), Modifier.size(200.dp).background(Color.White, RoundedCornerShape(12.dp)).padding(8.dp))
}

/** Finds the pending link request whose comparison code matches a scanned QR payload. */
fun matchLinkRequest(scanned: String?, requests: List<JSONObject>): JSONObject? {
    val digits = scanned?.takeIf { it.startsWith(LINK_QR_PREFIX) }?.removePrefix(LINK_QR_PREFIX)?.filter(Char::isDigit) ?: return null
    return requests.firstOrNull { it.optString("code").filter(Char::isDigit) == digits }
}

package com.convo.android

import android.content.Context
import android.provider.ContactsContract
import com.google.i18n.phonenumbers.PhoneNumberUtil
import java.util.Locale

/** Names remain local. Only normalized full numbers enter an explicit discovery request. */
data class PhoneContact(val name: String, val number: String)
fun readPhoneContacts(context: Context): List<PhoneContact> {
    val utility = PhoneNumberUtil.getInstance()
    val region = context.resources.configuration.locales[0]?.country?.takeIf { it.length == 2 } ?: "RO"
    val unique = linkedMapOf<String, PhoneContact>()
    context.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
        arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY, ContactsContract.CommonDataKinds.Phone.NUMBER),
        null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY + " ASC")?.use { cursor ->
        while (cursor.moveToNext()) {
            try {
                val parsed = utility.parse(cursor.getString(1), region.uppercase(Locale.ROOT))
                if (!utility.isValidNumber(parsed)) continue
                val number = utility.format(parsed, PhoneNumberUtil.PhoneNumberFormat.E164)
                unique.putIfAbsent(number, PhoneContact(cursor.getString(0) ?: number, number))
            } catch (_: Exception) { /* Invalid agenda entries do not stop discovery of valid contacts. */ }
        }
    }
    return unique.values.toList()
}

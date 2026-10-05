package it.campopronto.ads

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

/** Sessions only. Passwords and registration credentials are never persisted here. */
class SecureSession(context: Context) {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (ks.getKey("CampoPronto.session", null) as? SecretKey)
            ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                .apply {
                    init(
                        KeyGenParameterSpec.Builder(
                                "CampoPronto.session",
                                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                            )
                            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                            .build()
                    )
                }
                .generateKey()
    }

    fun read(): String? =
        runCatching {
                val raw =
                    Base64.decode(prefs.getString("cookie", null) ?: return null, Base64.NO_WRAP)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(
                    Cipher.DECRYPT_MODE,
                    key(),
                    GCMParameterSpec(128, raw.copyOfRange(0, 12)),
                )
                String(cipher.doFinal(raw.copyOfRange(12, raw.size)))
            }
            .getOrNull()

    fun write(value: String) {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        prefs
            .edit()
            .putString(
                "cookie",
                Base64.encodeToString(c.iv + c.doFinal(value.toByteArray()), Base64.NO_WRAP),
            )
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}

class Api(context: Context) {
    val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        explicitNulls = false
    }
    private val secure = SecureSession(context)
    private val jar =
        object : CookieJar {
            private var cookie =
                secure.read()?.let {
                    Cookie.parse("https://ombrelloni-ddb55.web.app".toHttpUrl(), it)
                }

            @Synchronized
            override fun loadForRequest(url: HttpUrl): List<Cookie> =
                cookie
                    ?.takeIf { it.expiresAt > System.currentTimeMillis() && it.matches(url) }
                    ?.let { listOf(it) } ?: emptyList()

            @Synchronized
            override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
                cookies
                    .firstOrNull {
                        it.name == "__session" && url.host == "ombrelloni-ddb55.web.app"
                    }
                    ?.let {
                        cookie = it
                        if (it.expiresAt > System.currentTimeMillis()) secure.write(it.toString())
                        else secure.clear()
                    }
            }

            @Synchronized
            fun clear() {
                cookie = null
                secure.clear()
            }
        }
    private val client =
        OkHttpClient.Builder()
            .cookieJar(jar)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(360, TimeUnit.SECONDS)
            .callTimeout(360, TimeUnit.SECONDS)
            .build()

    fun clear() = jar.clear()

    suspend fun request(
        path: String,
        venue: String?,
        method: String = "GET",
        body: JsonObject? = null,
    ): JsonElement =
        withContext(Dispatchers.IO) {
            val url =
                if (path == "venue-registration")
                    "https://europe-west1-ombrelloni-ddb55.cloudfunctions.net/campoprontoApi/api/venue-registration"
                else "https://ombrelloni-ddb55.web.app/api/$path"
            val builder = Request.Builder().url(url).header("Accept", "application/json")
            if (venue != null) builder.header("X-Establishment", venue)
            builder.method(
                method,
                if (method == "GET") null
                else
                    (body ?: buildJsonObject {})
                        .toString()
                        .toRequestBody("application/json".toMediaType()),
            )
            try {
                client.newCall(builder.build()).execute().use { response ->
                    val parsed =
                        runCatching { json.parseToJsonElement(response.body?.string() ?: "{}") }
                            .getOrElse { throw ApiException("NETWORK") }
                    if (!response.isSuccessful)
                        throw ApiException(
                            parsed.jsonObject["error"]?.jsonPrimitive?.content
                                ?: "HTTP_${response.code}"
                        )
                    parsed
                }
            } catch (e: java.io.IOException) {
                throw ApiException("NETWORK")
            }
        }
}

fun payload(vararg values: Pair<String, Any?>) = buildJsonObject {
    values.forEach { (key, value) ->
        put(
            key,
            when (value) {
                null -> JsonNull
                is JsonElement -> value
                is Boolean -> JsonPrimitive(value)
                is Number -> JsonPrimitive(value)
                is List<*> -> JsonArray(value.map { JsonPrimitive(it.toString()) })
                else -> JsonPrimitive(value.toString())
            },
        )
    }
}

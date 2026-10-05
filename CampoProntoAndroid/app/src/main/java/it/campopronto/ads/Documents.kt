package it.campopronto.ads

import android.content.Context
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object RegistrationPdf {
    suspend fun save(context: Context, uri: Uri, result: RegistrationResult) =
        withContext(Dispatchers.IO) {
            val document = PdfDocument()
            try {
                val paint =
                    Paint().apply {
                        isAntiAlias = true
                        color = android.graphics.Color.BLACK
                        textSize = 12f
                    }
                var pageNo = 0
                var y = 0f
                var page: PdfDocument.Page? = null
                fun text(value: String, x: Float = 44f, size: Float = 12f) {
                    paint.textSize = size
                    page!!.canvas.drawText(value, x, y, paint)
                }
                fun start() {
                    pageNo++
                    page =
                        document.startPage(PdfDocument.PageInfo.Builder(595, 842, pageNo).create())
                    y = 54f
                    text("CampoPronto ADS · Credenziali", size = 20f)
                    y = 82f
                    result.name.chunked(60).forEach {
                        text(it, size = 14f)
                        y += 20f
                    }
                    text("Stabilimento attivo · zero crediti iniziali", size = 10f)
                    y += 30f
                    paint.textSize = 10f
                    page!!.canvas.drawText("Pagina $pageNo", 44f, 810f, paint)
                }
                fun columns() {
                    text("N.", size = 10f)
                    text("Nome utente", 100f, 10f)
                    text("Password", 350f, 10f)
                    y += 26f
                }
                start()
                text("Account gestore", size = 14f)
                y += 24f
                text(result.manager.username)
                y += 24f
                text(result.manager.password, size = 11f)
                y += 30f
                text("Invito: campopronto://venue?id=${result.establishmentId}", size = 10f)
                y += 34f
                columns()
                result.credentials.forEachIndexed { index, c ->
                    if (y > 748f) {
                        document.finishPage(page)
                        start()
                        columns()
                    }
                    text("%03d".format(index + 1))
                    text(c.username, 100f)
                    text(c.password, 350f)
                    y += 25f
                }
                if (y > 735f) {
                    document.finishPage(page)
                    start()
                }
                y += 18f
                text("Consegna a ciascun cliente soltanto le proprie credenziali.", size = 10f)
                document.finishPage(page)
                context.contentResolver.openOutputStream(uri, "wt")?.use { document.writeTo(it) }
                    ?: error("Non riesco a salvare il documento.")
            } finally {
                document.close()
            }
            Unit
        }
}

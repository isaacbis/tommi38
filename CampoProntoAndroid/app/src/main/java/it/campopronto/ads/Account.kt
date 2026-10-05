package it.campopronto.ads

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable
fun AccountScreen(s: BeachStore, ads: NativeAds, onDone: () -> Unit) {
    var old by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var repeat by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    var blocked by remember { mutableStateOf<JsonArray>(JsonArray(emptyList())) }
    val scope = rememberCoroutineScope()
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            s.updateReminders(it)
            if (!it)
                s.message =
                    "Promemoria disattivati: autorizza le notifiche nelle impostazioni del telefono."
        }
    LaunchedEffect(Unit) {
        runCatching {
            blocked =
                s.requestRaw("community/blocks").jsonObject["items"]?.jsonArray
                    ?: JsonArray(emptyList())
        }
    }
    Page {
        Panel("Il tuo account") {
            Text(s.member?.username.orEmpty())
            Hint(
                if (s.member?.platformAdmin == true) "Amministratore globale"
                else if (s.member?.isManager == true) "Gestore dello stabilimento" else "Cliente"
            )
            Action(
                if (s.member?.demo == true) "Esci dalla demo" else "Esci dall’account",
                !s.busy,
            ) {
                s.logout()
                onDone()
            }
        }
        if (s.member?.demo != true && s.member?.managementMode != true)
            Panel("Cambia password") {
                Input("Password attuale", old, { old = it }, password = true)
                Input("Nuova password · almeno 12 caratteri", new, { new = it }, password = true)
                Input("Ripeti nuova password", repeat, { repeat = it }, password = true)
                Action(
                    "Salva password",
                    !s.busy && old.isNotEmpty() && new.length >= 12 && new == repeat,
                ) {
                    s.perform {
                        s.mutate(
                            "auth/password",
                            body = payload("currentPassword" to old, "newPassword" to new),
                        )
                        old = ""
                        new = ""
                        repeat = ""
                        s.message = "Password aggiornata."
                    }
                }
            }
        Panel("Preferenze") {
            TextButton({
                scope.launch {
                    try {
                        ads.privacy()
                    } catch (e: Exception) {
                        s.message = e.message
                    }
                }
            }) {
                Text("Preferenze pubblicità")
            }
            if (s.member?.demo != true)
                Toggle("Promemoria 30 minuti prima", s.reminders) { enabled ->
                    if (enabled && Build.VERSION.SDK_INT >= 33)
                        permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    else s.updateReminders(enabled)
                }
            Hint(
                "I promemoria sono locali e si aggiornano quando apri l’app. La lista d’attesa si controlla nell’app; non sono disponibili notifiche push."
            )
        }
        if (blocked.isNotEmpty())
            Panel("Utenti bloccati") {
                blocked.forEach { item ->
                    val obj = item.jsonObject
                    Text(obj["username"]?.jsonPrimitive?.content.orEmpty())
                    TextButton({
                        s.perform {
                            s.mutate(
                                "community/blocks/${obj["id"]?.jsonPrimitive?.content}",
                                "DELETE",
                            )
                            blocked =
                                s.requestRaw("community/blocks").jsonObject["items"]?.jsonArray
                                    ?: JsonArray(emptyList())
                        }
                    }) {
                        Text("Sblocca")
                    }
                }
            }
        Panel("Informazioni") {
            LinkButton("Privacy", "https://ombrelloni-ddb55.web.app/privacy.html")
            LinkButton("Assistenza", "https://ombrelloni-ddb55.web.app/support.html")
            Hint("CampoPronto ADS ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
        }
        if (s.member?.demo != true && s.member?.isManager != true)
            Panel("Elimina account") {
                Input("Password attuale", old, { old = it }, password = true)
                Hint(
                    "La cancellazione è definitiva. I dati vengono rimossi secondo l’informativa privacy."
                )
                Action("Voglio eliminare il mio account", old.isNotEmpty() && !s.busy) {
                    confirm = true
                }
            }
    }
    if (confirm)
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Eliminare definitivamente l’account?") },
            text = { Text("L’operazione rimuove i dati personali secondo l’informativa privacy.") },
            confirmButton = {
                TextButton({
                    confirm = false
                    s.perform {
                        s.mutate(
                            "auth/account",
                            "DELETE",
                            payload(
                                "username" to s.member?.username,
                                "currentPassword" to old,
                                "confirm" to true,
                            ),
                        )
                        old = ""
                        s.clearSession()
                        onDone()
                    }
                }) {
                    Text("Elimina definitivamente")
                }
            },
            dismissButton = { TextButton({ confirm = false }) { Text("Annulla") } },
        )
}

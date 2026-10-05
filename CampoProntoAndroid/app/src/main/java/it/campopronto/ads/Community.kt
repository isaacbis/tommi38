package it.campopronto.ads

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.*

@Composable
fun CommunityScreen(s: BeachStore) {
    var selected by remember { mutableStateOf<PlayerSearch?>(null) }
    var names by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("privacy") }
    LaunchedEffect(Unit) { s.perform { s.loadCommunity() } }
    Page {
        Text("Trova la tua squadra", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Hint("Le ricerche sono visibili agli utenti di questo stabilimento.")
        s.searches.forEach { item ->
            Panel(
                "${s.config.fields.find{it.id==item.fieldId}?.name?:item.fieldId} · ${item.time}"
            ) {
                Hint(item.date)
                Text("${item.spotsAvailable?:item.spotsNeeded?:0} posti disponibili")
                item.note?.let { Text(it) }
                Action("Vedi partita") { selected = item }
            }
            if (s.searches.isEmpty())
                Hint("Non ci sono ricerche aperte. Puoi crearne una dalle tue prenotazioni.")
            Panel("Lista d’attesa") {
                if (s.waiting.isEmpty()) Hint("Nessun orario in attesa.")
                s.waiting.forEach { w ->
                    Text(
                        "${s.config.fields.find{it.id==w.fieldId}?.name?:w.fieldId} · ${w.date} · ${w.time}"
                    )
                    if (w.available) Text("Si è liberato! Prenota dalla sezione Prenota.")
                    TextButton({
                        s.perform {
                            s.mutate("waitlist/${w.id}", "DELETE")
                            s.loadCommunity()
                        }
                    }) {
                        Text("Rimuovi dalla lista")
                    }
                }
            }
            TextButton({ s.perform { s.loadCommunity() } }) { Text("Aggiorna") }
        }
    }
    selected?.let { search ->
        AlertDialog(
            onDismissRequest = { selected = null },
            title = { Text("Partita · ${search.time}") },
            text = {
                Column {
                    Text(search.note.orEmpty())
                    Hint("${search.date} · ${search.spotsAvailable?:search.spotsNeeded?:0} posti")
                    if (search.isOwner || search.canManage) {
                        search.requests.forEach { r ->
                            Text(r.participantNames.joinToString())
                            Hint(r.phone.orEmpty())
                            Hint(r.status ?: "In attesa")
                            Row {
                                listOf("accepted" to "Accetta", "rejected" to "Rifiuta").forEach {
                                    (status, label) ->
                                    TextButton({
                                        selected = null
                                        s.perform {
                                            s.mutate(
                                                "player-searches/${search.id}/requests/${r.id}",
                                                "PATCH",
                                                payload("status" to status),
                                            )
                                            s.loadCommunity()
                                        }
                                    }) {
                                        Text(label)
                                    }
                                }
                            }
                            TextButton({
                                selected = null
                                s.perform {
                                    s.mutate("player-searches/${search.id}", "DELETE")
                                    s.loadCommunity()
                                }
                            }) {
                                Text("Chiudi ricerca")
                            }
                        }
                    } else if (search.myRequest != null) {
                        Text("Richiesta: ${search.myRequest.status}")
                        TextButton({
                            selected = null
                            s.perform {
                                s.mutate(
                                    "player-searches/${search.id}/requests/${search.myRequest.id}",
                                    "DELETE",
                                )
                                s.loadCommunity()
                            }
                        }) {
                            Text("Ritira richiesta")
                        }
                    } else {
                        Input("Nomi giocatori · separati da virgola", names, { names = it })
                        Input("Telefono per l’organizzatore", phone, { phone = it })
                        Hint("Nomi e telefono sono visibili all’organizzatore e al gestore.")
                        TextButton(
                            {
                                selected = null
                                s.perform {
                                    s.mutate(
                                        "player-searches/${search.id}/requests",
                                        body =
                                            payload(
                                                "participantNames" to
                                                    names.split(',').map { it.trim() },
                                                "phone" to phone,
                                            ),
                                    )
                                    s.loadCommunity()
                                }
                            },
                            enabled =
                                names.split(',').all { it.trim().length >= 2 } &&
                                    names.split(',').size <=
                                        minOf(
                                            12,
                                            search.spotsAvailable ?: search.spotsNeeded ?: 1,
                                        ) &&
                                    phone.length >= 6,
                        ) {
                            Text("Chiedi di partecipare")
                        }
                    }
                    Input("Motivo segnalazione (privacy, spam, other)", reason, { reason = it })
                    TextButton(
                        {
                            s.perform {
                                s.mutate(
                                    "player-searches/${search.id}/report",
                                    body = payload("reason" to reason),
                                )
                                s.message = "Segnalazione inviata al gestore."
                            }
                        },
                        enabled =
                            reason in listOf("privacy", "spam", "other", "harassment", "offensive"),
                    ) {
                        Text("Segnala al gestore")
                    }
                    if (!search.isOwner)
                        TextButton({
                            selected = null
                            s.perform {
                                s.mutate(
                                    "community/blocks",
                                    body = payload("searchId" to search.id),
                                )
                                s.loadCommunity()
                            }
                        }) {
                            Text("Blocca organizzatore")
                        }
                }
            },
            confirmButton = { TextButton({ selected = null }) { Text("Chiudi") } },
        )
    }
}

import SwiftUI

struct RootView: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        Group {
            if store.loading { ProgressView("Apro CampoPronto…") }
            else if store.member != nil { MainView() }
            else if store.selected != nil { LoginView() }
            else { WelcomeView() }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.22), value: store.member != nil)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: store.message)
        .task { await store.bootstrap() }
        .onChange(of: scenePhase) { _, phase in if phase == .active, store.member != nil { Task { await store.perform { try await store.refresh() } } } }
        .safeAreaInset(edge: .bottom) {
            if let message = store.message {
                HStack(alignment: .top) { Text(message).font(.footnote); Spacer(); Button { store.message = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.accessibilityLabel("Chiudi messaggio") }
                    .padding(12).background(.regularMaterial).clipShape(RoundedRectangle(cornerRadius: 12)).padding(.horizontal, 12).padding(.bottom, 4)
            }
        }
    }
}
struct WelcomeView: View {
    @EnvironmentObject var store: BeachStore
    @State private var query = ""
    @StateObject private var nearby = NearbyVenues()
    @State private var demo = false
    var filtered: [Venue] { store.venues.filter { query.isEmpty || ($0.name + " " + ($0.city ?? "")).localizedCaseInsensitiveContains(query) }.sorted { if nearby.location != nil { return (nearby.distance($0) ?? .infinity) < (nearby.distance($1) ?? .infinity) }; return false } }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack { Image(systemName: "sportscourt.fill").font(.title2).foregroundStyle(.white).padding(12).background(.blue.gradient, in: RoundedRectangle(cornerRadius: 16)); Text("CampoPronto ADS").font(.title2.bold()); Spacer() }
                        Text("Scegli dove giocare").font(.headline)
                        Text("Campi, partite e prenotazioni in un solo posto.").font(.subheadline).foregroundStyle(.secondary)
                    }.padding(.vertical, 8)
                }.listRowBackground(LinearGradient(colors: [.blue.opacity(0.10), .cyan.opacity(0.04)], startPoint: .topLeading, endPoint: .bottomTrailing))
                Section("Stabilimenti") {
                    Button { nearby.locate() } label: { Label(nearby.location == nil ? "Vicini a me" : "Ordinati per distanza", systemImage: "location") }
                    if let status = nearby.status { Text(status).font(.caption).foregroundStyle(.secondary) }
                    if filtered.isEmpty { ContentUnavailableView(query.isEmpty ? "Nessuno stabilimento disponibile" : "Nessun risultato", systemImage: "magnifyingglass") }
                    ForEach(filtered) { venue in
                        Button { Task { await store.choose(venue) } } label: {
                            HStack {
                                Image(systemName: "mappin.and.ellipse").font(.title3).foregroundStyle(.blue).frame(width: 42, height: 42).background(.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                                VStack(alignment: .leading) { Text(venue.name).font(.headline).foregroundStyle(.primary); if let city = venue.city, !city.isEmpty { Text(city).font(.caption).foregroundStyle(.secondary) } }
                                Spacer(); if let distance = nearby.distance(venue) { Text(String(format: "%.1f km", distance)).font(.caption).foregroundStyle(.secondary) }; Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 5)
                        }.buttonStyle(SoftPressStyle()).disabled(store.busy)
                    }
                }
                Section {
                    Button { demo = true } label: { Label("Sei un gestore? Prova per 10 minuti", systemImage: "sparkles") }
                    Text("Crea una demo privata: imposta i campi e prova anche come utente.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Cerca stabilimento o città")
            .navigationTitle("Benvenuto").navigationBarTitleDisplayMode(.inline)
            .refreshable { await store.bootstrap() }
            .sheet(isPresented: $demo) { DemoWizard() }
        }
    }
}
struct GalleryView: View {
    let photos: [Photo]
    @State private var expanded: Photo?
    var body: some View {
        if !photos.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(photos.enumerated()), id: \.offset) { _, photo in
                        Button { expanded = photo } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                AsyncImage(url: URL(string: photo.url)) { phase in
                                    if let image = phase.image { image.resizable().scaledToFit() }
                                    else { ZStack { Color.blue.opacity(0.08); Image(systemName: phase.error == nil ? "photo" : "photo.badge.exclamationmark").foregroundStyle(.secondary) } }
                                }.frame(width: 112, height: 64).background(Color.blue.opacity(0.04)).clipShape(RoundedRectangle(cornerRadius: 10))
                                if let caption = photo.caption, !caption.isEmpty { Text(caption).font(.caption2).foregroundStyle(.secondary).lineLimit(1).frame(width: 112, alignment: .leading) }
                            }
                        }.buttonStyle(SoftPressStyle()).accessibilityLabel(photo.caption?.isEmpty == false ? photo.caption! : "Apri foto dello stabilimento")
                    }
                }.padding(.vertical, 2)
            }
            .sheet(isPresented: Binding(get: { expanded != nil }, set: { if !$0 { expanded = nil } })) {
                if let photo = expanded {
                    NavigationStack {
                        VStack(spacing: 16) {
                            AsyncImage(url: URL(string: photo.url)) { image in image.resizable().scaledToFit() } placeholder: { Image(systemName: "photo").font(.largeTitle).foregroundStyle(.secondary) }
                            if let caption = photo.caption { Text(caption).font(.subheadline) }
                            if let link = photo.link, let url = URL(string: link), ["https", "http"].contains(url.scheme?.lowercased() ?? "") { Link("Scopri di più", destination: url) }
                        }.padding().navigationTitle("Foto dello stabilimento").navigationBarTitleDisplayMode(.inline).toolbar { Button("Chiudi") { expanded = nil } }
                    }
                }
            }
        }
    }
}
struct SoftPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.75 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: configuration.isPressed)
    }
}
struct LoginView: View {
    @EnvironmentObject var store: BeachStore
    @State private var username = ""
    @State private var password = ""
    @State private var register = false
    var body: some View {
        NavigationStack {
            Form {
                Section { Text(store.selected?.name ?? "CampoPronto").font(.title2.bold()); GalleryView(photos: store.config.gallery ?? []) }
                Section("Accedi") {
                    TextField("Username", text: $username).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(.password)
                    Button { Task { await store.login(username: username, password: password); if store.member != nil { password = "" } } } label: { HStack { Spacer(); if store.busy { ProgressView() } else { Text("Accedi").bold() }; Spacer() } }.disabled(store.busy || username.isEmpty || password.isEmpty)
                }
                if store.config.registrationEnabled == true {
                    Section { Button("Crea un account") { register = true } }
                }
                Section { Text("Non ricordi le credenziali? Puoi inviare una richiesta al gestore.").font(.footnote).foregroundStyle(.secondary); Button("Richiedi recupero password") { Task { await store.perform { try await store.mutate("auth/recovery-request", body: ["username": username.trimmingCharacters(in: .whitespacesAndNewlines)]); store.message = "Se l’account esiste, la richiesta è stata inviata al gestore. Contattalo per il recupero." } } }.disabled(store.busy || username.trimmingCharacters(in: .whitespacesAndNewlines).count < 3); Link("Assistenza e privacy", destination: URL(string: "https://ombrelloni-ddb55.web.app/privacy.html")!) }
            }
            .navigationTitle("Il tuo stabilimento").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Indietro") { store.selected = nil } } }
            .sheet(isPresented: $register) { RegisterView() }
        }
    }
}
struct RegisterView: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.dismiss) var dismiss
    @State private var username = ""
    @State private var password = ""
    var body: some View {
        NavigationStack {
            Form {
                TextField("Username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Password (almeno 12 caratteri)", text: $password).textContentType(.newPassword)
                Text("Il gestore potrebbe dover approvare l’iscrizione. I crediti si ottengono con video o pacchetti disponibili.").font(.footnote)
                Button("Richiedi iscrizione") { Task { await store.perform { try await store.mutate("auth/register", body: ["username": username, "password": password]); password = ""; dismiss(); store.message = "Iscrizione inviata. Puoi accedere quando il gestore ti approva." } } }.disabled(store.busy || username.count < 3 || password.count < 12)
            }.navigationTitle("Registrati").toolbar { Button("Chiudi") { dismiss() } }
        }
    }
}
struct DemoWizard: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.dismiss) var dismiss
    @State private var setup = DemoSetup()
    @State private var step = 0
    var valid: Bool { Clock.validTime(setup.dayStart) && Clock.validTime(setup.dayEnd) && !setup.name.trimmingCharacters(in: .whitespaces).isEmpty && setup.fields.allSatisfy { !$0.trimmingCharacters(in: .whitespaces).isEmpty } && Set(setup.fields.map { $0.lowercased().trimmingCharacters(in: .whitespaces) }).count == setup.fields.count && Clock.minutes(setup.dayEnd) - Clock.minutes(setup.dayStart) >= setup.slotMinutes }
    var body: some View {
        NavigationStack {
            Form {
                Section { ProgressView(value: Double(step + 1), total: 3); Text("Passo \(step + 1) di 3 · Il tempo parte quando entri").font(.caption).foregroundStyle(.secondary) }
                if step == 0 {
                    Section("Il tuo stabilimento") { TextField("Nome dello stabilimento", text: $setup.name) }
                    Section("Come si chiamano i campi?") {
                        ForEach(setup.fields.indices, id: \.self) { i in TextField("Nome campo", text: $setup.fields[i]) }
                        if setup.fields.count < 6 { Button("Aggiungi un campo") { setup.fields.append("Campo \(setup.fields.count + 1)") } }
                        if setup.fields.count > 1 { Button("Rimuovi l’ultimo campo", role: .destructive) { setup.fields.removeLast() } }
                    }
                } else if step == 1 {
                    Section("Orari") {
                        TextField("Apertura (HH:mm)", text: $setup.dayStart).keyboardType(.numbersAndPunctuation)
                        TextField("Chiusura (HH:mm)", text: $setup.dayEnd).keyboardType(.numbersAndPunctuation)
                        Picker("Durata prenotazione", selection: $setup.slotMinutes) { ForEach([15,30,40,60,90], id: \.self) { Text("\($0) minuti").tag($0) } }
                    }
                } else {
                    Section("La tua demo") { Text(setup.name).bold(); Text(setup.fields.joined(separator: " · ")); Text("\(setup.dayStart)–\(setup.dayEnd) · \(setup.slotMinutes) minuti") }
                    Section { Text("Puoi cambiare tra gestore e utente, provare prenotazioni e impostazioni. La demo è privata e termina dopo 10 minuti. Non contiene clienti reali né pubblicità.").font(.footnote) }
                }
                Section {
                    Button(step < 2 ? "Continua" : "Inizia la demo") { if step < 2 { step += 1 } else { launch(setup) } }.disabled(!valid || store.busy)
                    if step > 0 { Button("Indietro") { step -= 1 }.disabled(store.busy) }
                    Button("Salta e usa le impostazioni di base") { launch(nil) }.disabled(store.busy)
                }
            }.navigationTitle("Prova l’app").navigationBarTitleDisplayMode(.inline).toolbar { Button("Chiudi") { dismiss() }.disabled(store.busy) }
        }
    }
    func launch(_ value: DemoSetup?) { Task { await store.startDemo(value); if store.member != nil { dismiss() } } }
}
struct MainView: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var account = false
    @State private var adChecked = false
    var body: some View {
        TabView {
            shell { HomeView() }.tabItem { Label("Home", systemImage: "house.fill") }
            shell { BookingView() }.tabItem { Label("Campi", systemImage: "sportscourt") }
            shell { MyBookingsView() }.tabItem { Label("Le mie", systemImage: "calendar") }
            if store.member?.isManager == true {
                shell { ManagementView() }.tabItem { Label("Gestione", systemImage: "slider.horizontal.3") }
            } else {
                shell { CreditsView() }.tabItem { Label("Crediti", systemImage: "play.circle") }
            }
            shell { CommunityView() }.tabItem { Label("Giocatori", systemImage: "person.2") }
        }.tint(.blue).animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: store.member?.role).sheet(isPresented: $account) { AccountView() }
        .task {
            guard !adChecked, store.shouldShowLoginAd, store.member?.demo != true, store.member?.isManager != true else { return }; adChecked = true; store.shouldShowLoginAd = false
            do { let status: AdsStatus = try await store.request("ads/status"); if status.available { try await NativeAds.shared.showLoginAd() } } catch { /* Advertising must never prevent access. */ }
        }
    }
    func shell<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        NavigationStack {
            content().navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        if store.member?.demo == true {
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                let seconds = max(0, Int((store.member?.demoExpiresAt ?? 0) / 1000 - context.date.timeIntervalSince1970))
                                Text("Demo · \(seconds / 60):\(String(format: "%02d", seconds % 60))").font(.caption.bold()).foregroundStyle(.orange)
                                    .onChange(of: seconds) { _, value in if value == 0 { store.clearSession(); store.message = "La demo è terminata. Puoi provarne un’altra dalla pagina iniziale." } }
                            }
                        } else { Text(store.selected?.name ?? "CampoPronto ADS").font(.headline).lineLimit(1) }
                    }
                    ToolbarItem(placement: .topBarLeading) { if store.member?.demo == true { Button { Task { await store.changeDemoRole() } } label: { Image(systemName: "arrow.triangle.2.circlepath").accessibilityLabel("Cambia ruolo") }.disabled(store.busy) } }
                    ToolbarItem(placement: .topBarTrailing) { Button { account = true } label: { Image(systemName: "person.crop.circle") }.accessibilityLabel("Account e impostazioni") }
                }
        }
    }
}
struct HomeView: View {
    @EnvironmentObject var store: BeachStore
    var body: some View {
        List {
            Section {
                HStack { VStack(alignment: .leading, spacing: 5) { Text("Ciao, \(store.member?.username ?? "")").font(.title2.bold()); Text(store.member?.isManager == true ? "Gestisci il tuo stabilimento" : "Pronto a giocare?").foregroundStyle(.secondary) }; Spacer(); Image(systemName: "sportscourt.fill").font(.largeTitle).foregroundStyle(.white).padding(12).background(.blue.gradient, in: RoundedRectangle(cornerRadius: 18)) }.padding(.vertical, 8)
                if store.member?.demo == true { Text("Stai provando come \(store.member?.isManager == true ? "gestore" : "utente"). Usa il pulsante in alto a sinistra per cambiare ruolo.").font(.footnote).foregroundStyle(.orange) }
                GalleryView(photos: store.config.gallery ?? [])
            }
            Section {
                NavigationLink { BookingView() } label: { Label("Prenota un campo", systemImage: "calendar.badge.plus").font(.headline) }
                if store.member?.managementMode != true { NavigationLink { CreditsView() } label: { HStack { Label("I tuoi crediti", systemImage: "circle.hexagongrid"); Spacer(); Text("\(store.member?.credits ?? 0)").font(.title3.bold()).foregroundStyle(.blue) } } }
            }
            if let next = store.mine.sorted(by: { $0.date + $0.time < $1.date + $1.time }).first {
                Section("La tua prossima partita") { BookingRow(booking: next) }
            }
            if store.selected?.id == "tommi38" { Section { WeatherSummaryView() } }
            if let notes = store.config.notesText, !notes.isEmpty { Section("Dal tuo stabilimento") { Text(notes) } }
            Section("Come funziona") { Text("Un credito permette una prenotazione. Scegli il campo e un orario libero. Se è occupato, puoi entrare in lista d’attesa.").font(.footnote).foregroundStyle(.secondary) }
        }.refreshable { await store.perform { try await store.refresh() } }
    }
}
struct BookingRow: View {
    @EnvironmentObject var store: BeachStore
    let booking: Booking
    var body: some View {
        VStack(alignment: .leading, spacing: 5) { Text(store.config.fields.first { $0.id == booking.fieldId }?.name ?? booking.fieldId).font(.headline); Text("\(booking.date) · \(booking.time)").font(.subheadline).foregroundStyle(.secondary); if store.member?.isManager == true, let name = booking.user, !name.isEmpty { Text(name).font(.caption) } }
    }
}
struct BookingView: View {
    @EnvironmentObject var store: BeachStore
    @State private var field = ""
    @State private var choice: String?
    @State private var occupied: Booking?
    @State private var bookingUser = ""
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.scenePhase) private var scenePhase
    var activeField: String { store.config.fields.contains(where: { $0.id == field }) ? field : (store.config.fields.first?.id ?? "") }
    var body: some View {
        List {
            Section {
                DatePicker("Giorno", selection: $store.selectedDay, in: Date()..., displayedComponents: .date)
                Picker("Campo", selection: Binding(get: { activeField }, set: { field = $0 })) { ForEach(store.config.fields) { Text($0.name).tag($0.id) } }.pickerStyle(.menu)
                if store.member?.isManager == true {
                    Picker("Prenota per", selection: $bookingUser) { Text("Scegli un utente").tag(""); ForEach(store.users.filter { $0.role == "user" && $0.disabled != true && $0.pendingApproval != true }) { user in Text(user.username).tag(user.username) } }
                    Text("La prenotazione viene intestata all’utente scelto. Non vengono assegnati nuovi crediti.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Section {
                if store.dayLoading { HStack { ProgressView(); Text("Aggiorno gli orari…").font(.caption).foregroundStyle(.secondary) } }
            }
            Section("Scegli l’orario") {
                if store.config.fields.isEmpty { ContentUnavailableView("Nessun campo disponibile", systemImage: "sportscourt", description: Text("Il gestore deve configurare i campi.")) }
                else {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: typeSize.isAccessibilitySize ? 2 : 4), spacing: 8) {
                        ForEach(Clock.slots(store.config), id: \.self) { time in
                            let booked = store.bookings.first { $0.overlaps(day: Clock.day(store.selectedDay), field: activeField, time: time, duration: store.config.slotMinutes, fallbackDuration: store.config.slotMinutes) }
                            let closed = store.closures.contains { $0.fieldId == activeField && $0.contains(Clock.day(store.selectedDay), time, duration: store.config.slotMinutes) }
                            let past = (Clock.date(day: Clock.day(store.selectedDay), time: time) ?? .distantPast) <= Date()
                            Button { if let booked { occupied = booked } else { choice = time } } label: {
                                VStack(spacing: 3) { Text(time).font(.subheadline.monospacedDigit().bold()); Text(closed ? "Chiuso" : (booked == nil ? "Libero" : "Occupato")).font(.system(size: 10)) }
                                    .frame(maxWidth: .infinity, minHeight: 44).foregroundStyle(closed || past ? Color.secondary : (booked == nil ? Color.blue : Color.orange))
                                    .background((booked == nil ? Color.blue : Color.orange).opacity(closed || past ? 0.04 : 0.1), in: RoundedRectangle(cornerRadius: 9))
                            }.buttonStyle(SoftPressStyle()).disabled(closed || past || store.busy || store.dayLoading || (store.member?.isManager == true && bookingUser.isEmpty))
                        }
                    }.padding(.vertical, 5)
                }
            }
            Section { Label("\(store.config.slotMinutes) minuti · 1 credito", systemImage: "clock").font(.caption); Text("Gli orari si riferiscono al fuso orario italiano.").font(.caption).foregroundStyle(.secondary) }
        }
        .task { if store.member?.isManager == true { await store.perform { try await store.loadUsers() } } }
        .task(id: Clock.day(store.selectedDay)) {
            do {
                try await store.loadDay()
                while !Task.isCancelled {
                    try await Task.sleep(for: .seconds(20))
                    if scenePhase == .active, !store.busy { try await store.loadDay() }
                }
            } catch is CancellationError {} catch { if !Task.isCancelled { store.message = error.localizedDescription } }
        }
        .refreshable { await store.perform { try await store.loadDay() } }
        .alert("Conferma prenotazione", isPresented: Binding(get: { choice != nil }, set: { if !$0 { choice = nil } })) {
            Button("Annulla", role: .cancel) { choice = nil }
            Button(store.member?.isManager == true ? "Conferma per utente" : "Prenota · 1 credito") { let time = choice ?? ""; choice = nil; Task { await store.perform { if store.member?.isManager == true { try await store.mutate("admin/reservations", body: ["username": bookingUser, "fieldId": activeField, "date": Clock.day(store.selectedDay), "time": time]) } else { try await store.mutate("reservations", body: ["fieldId": activeField, "date": Clock.day(store.selectedDay), "time": time]) }; try await store.refresh(); store.message = "Prenotazione confermata." } } }
        } message: { Text("\(store.config.fields.first { $0.id == activeField }?.name ?? "Campo") · \(Clock.day(store.selectedDay)) alle \(choice ?? "")") }
        .alert("Orario occupato", isPresented: Binding(get: { occupied != nil }, set: { if !$0 { occupied = nil } })) {
            Button("Chiudi", role: .cancel) { occupied = nil }
            if store.member?.managementMode != true && occupied?.user != store.member?.username { Button("Entra in lista d’attesa") { let id = occupied?.id ?? ""; occupied = nil; Task { await store.perform { try await store.mutate("waitlist", body: ["reservationId": id]); store.message = "Sei in lista d’attesa. Puoi controllare la disponibilità nella sezione Giocatori." } } } }
        } message: { Text("Puoi controllare se si libera dalla tua lista d’attesa.") }
    }
}
struct MyBookingsView: View {
    @EnvironmentObject var store: BeachStore
    @State private var cancel: Booking?
    @State private var search: Booking?
    var body: some View {
        List {
            if store.mine.isEmpty { ContentUnavailableView("Ancora nessuna prenotazione", systemImage: "calendar", description: Text("Scegli un orario nella sezione Campi.")) }
            ForEach(store.mine) { booking in
                VStack(alignment: .leading, spacing: 10) { BookingRow(booking: booking); HStack { Button("Cerco giocatori") { search = booking }.buttonStyle(.bordered); Spacer(); Button("Annulla", role: .destructive) { cancel = booking }.buttonStyle(.bordered) } }
            }
        }.refreshable { await store.perform { try await store.refresh() } }
            .confirmationDialog("Annullare la prenotazione? Il credito viene restituito se previsto dalle regole dello stabilimento.", isPresented: Binding(get: { cancel != nil }, set: { if !$0 { cancel = nil } }), titleVisibility: .visible) {
                Button("Annulla prenotazione", role: .destructive) { let id = cancel?.id ?? ""; cancel = nil; Task { await store.perform { try await store.mutate("reservations/" + id, method: "DELETE"); try await store.refresh() } } }
            }
            .sheet(item: $search) { SearchCreateView(booking: $0) }
    }
}
struct CreditsView: View {
    @EnvironmentObject var store: BeachStore
    @State private var adBusy = false
    var body: some View {
        List {
            Section { HStack { Text("Il tuo saldo"); Spacer(); Text("\(store.member?.credits ?? 0)").font(.largeTitle.bold()).foregroundStyle(.blue) }; Text("1 credito = 1 prenotazione").font(.caption).foregroundStyle(.secondary) }
            Section("Ottieni un credito") {
                if store.member?.demo == true { Text("La demo include crediti di prova. I video e i pagamenti sono disattivati.") }
                else if store.ads?.earned == true { Label("Hai ottenuto il credito di oggi", systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
                else {
                    Button { Task { await reward() } } label: { HStack { Label(adBusy ? "Attendi il video…" : "Guarda un video · 1 credito", systemImage: "play.circle.fill"); if adBusy { ProgressView() } } }.disabled(adBusy || store.ads?.available != true)
                    Text(store.ads?.available == true ? "Completa il video. Il credito arriva dopo la verifica, al massimo una volta al giorno." : "Al momento i video non sono disponibili. Riprova più tardi.").font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section("Pacchetti crediti") { Text("Gli acquisti non sono ancora disponibili. Verranno mostrati qui quando il servizio di pagamento sarà attivo.").font(.footnote).foregroundStyle(.secondary) }
            Section("Movimenti") { if store.movements.isEmpty { Text("Nessun movimento").foregroundStyle(.secondary) }; ForEach(store.movements) { m in HStack { VStack(alignment: .leading) { Text(m.displayReason); if let at = m.at { Text(String(at.prefix(10))).font(.caption).foregroundStyle(.secondary) } }; Spacer(); Text(m.delta > 0 ? "+\(m.delta)" : "\(m.delta)").foregroundStyle(m.delta > 0 ? .green : .primary).monospacedDigit() } } }
        }.task { await store.perform { try await store.loadCredits() } }.refreshable { await store.perform { try await store.loadCredits() } }
    }
    func reward() async {
        guard !adBusy, let username = store.member?.username, let venue = store.selected?.id else { return }; adBusy = true; defer { adBusy = false }
        var token: String?
        do {
            #if DEBUG
            let earned = try await NativeAds.shared.reward(token: String(repeating: "0", count: 64))
            store.message = earned ? "Video di prova completato. I video di test non assegnano crediti reali." : "Video di prova chiuso."
            #else
            let r: RewardToken = try await store.request("ads/start", method: "POST", body: [:]); token = r.token
            let earned = try await NativeAds.shared.reward(token: r.token)
            guard store.member?.username == username, store.selected?.id == venue else { return }
            if earned {
                for attempt in 0..<30 {
                    try await store.loadCredits()
                    if store.ads?.earned == true { store.message = "Il tuo credito è disponibile!"; return }
                    try await Task.sleep(for: .milliseconds(attempt < 8 ? 1000 : 2500))
                    guard store.member?.username == username, store.selected?.id == venue else { return }
                }
                store.message = "Il video è completato. La verifica è ancora in corso: aggiorna il saldo tra poco."
            } else { try await store.mutate("ads/cancel", body: ["token": r.token]); store.message = "Completa il video per ottenere il credito." }
            #endif
        } catch {
            if let token, store.member?.username == username, store.selected?.id == venue { try? await store.mutate("ads/cancel", body: ["token": token]) }
            store.message = error.localizedDescription
        }
    }
}
struct CommunityView: View {
    @EnvironmentObject var store: BeachStore
    var body: some View {
        List {
            Section("Cerco giocatori") {
                if store.searches.isEmpty { Text("Nessuna partita aperta. Puoi cercare giocatori da una tua prenotazione.").foregroundStyle(.secondary) }
                ForEach(store.searches) { item in NavigationLink { SearchDetailView(search: item) } label: { VStack(alignment: .leading, spacing: 4) { Text(store.config.fields.first { $0.id == item.fieldId }?.name ?? item.fieldId).font(.headline); Text("\(item.date) · \(item.time) · \(item.spotsAvailable ?? item.spotsNeeded ?? 0) posti").font(.caption); if let note = item.note { Text(note).font(.subheadline).foregroundStyle(.secondary) } } } }
            }
            if store.member?.managementMode != true { Section { NavigationLink("Utenti bloccati") { BlockedUsersView() } } }
            Section("La tua lista d’attesa") {
                if store.waiting.isEmpty { Text("Nessun orario in attesa").foregroundStyle(.secondary) }
                ForEach(store.waiting) { item in VStack(alignment: .leading) { Text("\(store.config.fields.first { $0.id == item.fieldId }?.name ?? item.fieldId) · \(item.date) · \(item.time)"); if item.available == true { Text("Si è liberato! Prenota dalla sezione Campi.").foregroundStyle(.green) }; Button("Rimuovi", role: .destructive) { Task { await store.perform { try await store.mutate("waitlist/" + item.id, method: "DELETE"); try await store.loadCommunity() } } }.font(.caption) } }
            }
        }.task { await store.perform { try await store.loadCommunity() } }.refreshable { await store.perform { try await store.loadCommunity() } }
    }
}
struct SearchCreateView: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.dismiss) var dismiss
    let booking: Booking
    @State private var count = 1
    @State private var note = ""
    var body: some View {
        NavigationStack { Form { Stepper("\(count) giocatori cercati", value: $count, in: 1...12); TextField("Messaggio (facoltativo)", text: $note, axis: .vertical); Text("Pubblica solo informazioni che vuoi condividere con gli utenti dello stabilimento. Non inserire dati sensibili.").font(.caption).foregroundStyle(.secondary); Button("Pubblica ricerca") { Task { await store.perform { try await store.mutate("player-searches", body: ["reservationId": booking.id, "spotsNeeded": count, "note": note]); dismiss() } } }.disabled(store.busy || note.count > 200) }.navigationTitle("Cerco giocatori").toolbar { Button("Chiudi") { dismiss() } } }
    }
}
struct SearchDetailView: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.dismiss) var dismiss
    let search: PlayerSearch
    @State private var names = [""]
    @State private var phone = ""
    @State private var reason = "other"
    var body: some View {
        Form {
            Section("La partita") { Text("\(search.date) · \(search.time)"); Text(search.note ?? ""); Text("\(search.spotsAvailable ?? search.spotsNeeded ?? 0) posti disponibili") }
            if search.isOwner == true || search.canManage == true {
                Section("Richieste") {
                    ForEach(search.requests ?? []) { r in VStack(alignment: .leading) { Text((r.participantNames ?? []).joined(separator: ", ")); Text(r.status ?? "In attesa").font(.caption); if let phone = r.phone { Text(phone).font(.caption) }; HStack { Button("Accetta") { decide(r, "accepted") }; Button("Rifiuta", role: .destructive) { decide(r, "rejected") } } } }
                    Button("Chiudi ricerca", role: .destructive) { Task { await store.perform { try await store.mutate("player-searches/" + search.id, method: "DELETE"); try await store.loadCommunity(); dismiss() } } }
                }
            } else if let r = search.myRequest {
                Section { Text("La tua richiesta: \(r.status ?? "In attesa")"); Button("Ritira richiesta", role: .destructive) { Task { await store.perform { try await store.mutate("player-searches/\(search.id)/requests/\(r.id)", method: "DELETE"); try await store.loadCommunity(); dismiss() } } } }
            } else {
                Section("Chiedi di partecipare") { ForEach(names.indices, id: \.self) { i in TextField("Nome giocatore \(i + 1)", text: $names[i]) }; if names.count < min(12, search.spotsAvailable ?? search.spotsNeeded ?? 1) { Button("Aggiungi giocatore") { names.append("") } }; if names.count > 1 { Button("Rimuovi ultimo giocatore") { names.removeLast() } }; TextField("Telefono per l’organizzatore", text: $phone).keyboardType(.phonePad); Text("Nome e telefono saranno visibili all’organizzatore e al gestore.").font(.caption); Button("Invia richiesta") { Task { await store.perform { try await store.mutate("player-searches/\(search.id)/requests", body: ["participantNames": names.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }, "phone": phone]); try await store.loadCommunity(); dismiss() } } }.disabled(names.contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 } || phone.count < 6 || store.busy) }
            }
            Section("Segnala un problema") { Picker("Motivo", selection: $reason) { Text("Molestie").tag("harassment"); Text("Contenuto offensivo").tag("offensive"); Text("Spam").tag("spam"); Text("Privacy").tag("privacy"); Text("Altro").tag("other") }; Button("Segnala al gestore", role: .destructive) { Task { await store.perform { try await store.mutate("player-searches/\(search.id)/report", body: ["reason": reason]); store.message = "Segnalazione inviata al gestore." } } }.disabled(store.busy); if search.isOwner != true { Button("Blocca l’organizzatore", role: .destructive) { Task { await store.perform { try await store.mutate("community/blocks", body: ["searchId": search.id]); try await store.loadCommunity(); dismiss() } } }.disabled(store.busy) } }
        }.navigationTitle("Giocatori")
    }
    func decide(_ request: PlayerRequest, _ status: String) { Task { await store.perform { try await store.mutate("player-searches/\(search.id)/requests/\(request.id)", method: "PATCH", body: ["status": status]); try await store.loadCommunity(); dismiss() } } }
}
struct AccountView: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.dismiss) var dismiss
    @State private var deletion = false
    @State private var password = ""
    @State private var confirm = false
    @AppStorage("bookingReminders") private var reminders = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Account") { Text(store.member?.username ?? ""); if store.member?.demo != true && store.member?.managementMode != true { NavigationLink("Cambia password") { PasswordView(target: nil) } }; Text(store.member?.platformAdmin == true ? "Amministratore globale" : (store.member?.isManager == true ? "Gestore dello stabilimento" : "Utente")).foregroundStyle(.secondary); Button(store.member?.demo == true ? "Esci dalla demo" : "Esci dall’account") { Task { await store.logout(); dismiss() } } }
                Section("Informazioni") { Link("Privacy", destination: URL(string: "https://ombrelloni-ddb55.web.app/privacy.html")!); Link("Assistenza", destination: URL(string: "https://ombrelloni-ddb55.web.app/support.html")!); Button("Preferenze pubblicità") { Task { do { try await NativeAds.shared.privacy() } catch { store.message = error.localizedDescription } } }; if store.member?.demo != true { Toggle("Promemoria 30 minuti prima", isOn: Binding(get: { reminders }, set: { value in Task { if value { do { reminders = try await BookingReminders.enable() } catch { store.message = error.localizedDescription } } else { reminders = false }; await BookingReminders.sync(store.mine, fields: store.config.fields, enabled: reminders) } })); Text("I promemoria sono locali. Le novità della lista d’attesa si controllano nell’app; non sono ancora disponibili notifiche push.").font(.caption).foregroundStyle(.secondary) } }
                if store.member?.demo != true && store.member?.isManager != true {
                    Section { Toggle("Voglio eliminare il mio account", isOn: $deletion); if deletion { SecureField("Password attuale", text: $password); Button("Elimina account", role: .destructive) { confirm = true }.disabled(password.isEmpty || store.busy) } }
                }
            }.navigationTitle("Il tuo account").toolbar { Button("Chiudi") { dismiss() } }
                .confirmationDialog("Eliminare definitivamente l’account? Verranno rimossi i tuoi dati secondo l’informativa privacy.", isPresented: $confirm, titleVisibility: .visible) { Button("Elimina definitivamente", role: .destructive) { Task { await store.perform { try await store.mutate("auth/account", method: "DELETE", body: ["username": store.member?.username ?? "", "currentPassword": password, "confirm": true]); password = ""; store.clearSession(); dismiss() } } } }
        }
    }
}

struct PasswordView: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.dismiss) var dismiss
    let target: String?
    @State private var old = ""
    @State private var new = ""
    @State private var repeatPassword = ""
    var body: some View {
        Form {
            if target == nil { SecureField("Password attuale", text: $old).textContentType(.password) } else { Text("Nuova password per \(target ?? "")").font(.headline) }
            SecureField("Nuova password (almeno 12 caratteri)", text: $new).textContentType(.newPassword)
            SecureField("Ripeti nuova password", text: $repeatPassword).textContentType(.newPassword)
            Button("Salva password") { Task { await store.perform {
                if let target { try await store.mutate("admin/users/password", method: "PUT", body: ["username": target, "newPassword": new]) }
                else { try await store.mutate("auth/password", body: ["currentPassword": old, "newPassword": new]) }
                old = ""; new = ""; repeatPassword = ""; store.message = "Password aggiornata."; dismiss()
            } } }.disabled(store.busy || new.count < 12 || new != repeatPassword || (target == nil && old.isEmpty))
        }.navigationTitle("Password")
    }
}

struct BlockedUser: Decodable, Identifiable { let id: String; let username: String }
struct BlockedUsersView: View {
    @EnvironmentObject var store: BeachStore
    @State private var items: [BlockedUser] = []
    var body: some View {
        List {
            if items.isEmpty { ContentUnavailableView("Nessun utente bloccato", systemImage: "person.crop.circle.badge.checkmark") }
            ForEach(items) { user in HStack { Text(user.username); Spacer(); Button("Sblocca") { Task { await store.perform { try await store.mutate("community/blocks/" + user.id, method: "DELETE"); try await load(); try await store.loadCommunity() } } }.disabled(store.busy) } }
        }.navigationTitle("Utenti bloccati").task { await store.perform { try await load() } }.refreshable { await store.perform { try await load() } }
    }
    func load() async throws { let response: Items<BlockedUser> = try await store.request("community/blocks"); items = response.items }
}

struct WeatherForecast: Decodable {
    struct Daily: Decodable { let time: [String]; let weathercode: [Int]; let temperature_2m_max: [Double]; let temperature_2m_min: [Double] }
    let daily: Daily
}
struct WeatherSummaryView: View {
    @EnvironmentObject var store: BeachStore
    @State private var forecast: WeatherForecast?
    var body: some View {
        DisclosureGroup("Meteo · area Tommi38") {
            if let daily = forecast?.daily {
                ForEach(Array(daily.time.prefix(3).enumerated()), id: \.offset) { index, day in
                    if index < daily.temperature_2m_max.count && index < daily.temperature_2m_min.count {
                        HStack { Text(day); Spacer(); Text("\(Int(daily.temperature_2m_max[index].rounded()))° / \(Int(daily.temperature_2m_min[index].rounded()))°").monospacedDigit() }.font(.caption)
                    }
                }
            } else { Text("Previsioni non disponibili al momento").font(.caption).foregroundStyle(.secondary) }
        }.task { forecast = try? await store.request("weather") }
    }
}

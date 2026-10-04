import SwiftUI
import UIKit

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
    @AppStorage("lastRealVenue") private var lastVenueID = ""
    @State private var query = ""
    @StateObject private var nearby = NearbyVenues()
    @State private var demo = false
    @State private var venueRegistration = false
    @State private var showAll = false
    @State private var nearbyOnly = false
    @State private var resultLimit = 20
    @FocusState private var searchFocused: Bool
    var searchTerm: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    var showingResults: Bool { !searchTerm.isEmpty || showAll || nearbyOnly }
    var filtered: [Venue] {
        store.venues.filter { venue in
            (searchTerm.isEmpty || (venue.name + " " + (venue.city ?? "")).localizedCaseInsensitiveContains(searchTerm)) && (!nearbyOnly || nearby.distance(venue) != nil)
        }.sorted { lhs, rhs in
            if nearbyOnly { return (nearby.distance(lhs) ?? .infinity) < (nearby.distance(rhs) ?? .infinity) }
            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }
    }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 13) {
                        Image(systemName: "sportscourt.fill").font(.title2).foregroundStyle(.white)
                            .frame(width: 52, height: 52)
                            .background(LinearGradient(colors: [.blue, .teal], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("La tua prossima partita").font(.title3.bold())
                            Text("Trova il posto. Scegli il campo.").font(.footnote).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 3)
                }.listRowBackground(Color.clear).listRowSeparator(.hidden)
                if let lastVenue = store.venues.first(where: { $0.id == lastVenueID }) {
                    Section {
                        Button { Task { await store.choose(lastVenue) } } label: {
                            welcomeAction("Torna a " + lastVenue.name, subtitle: "Il tuo ultimo stabilimento", icon: "arrow.uturn.backward", color: .teal)
                        }.buttonStyle(SoftPressStyle()).disabled(store.busy)
                    }
                }
                Section("Per i gestori") {
                    Button { searchFocused = false; venueRegistration = true } label: {
                        welcomeAction("Registra il tuo stabilimento", subtitle: "Campi, orari e utenti in pochi passi", icon: "building.2.crop.circle", color: .blue)
                    }.buttonStyle(SoftPressStyle())
                    Button { searchFocused = false; demo = true } label: {
                        welcomeAction("Prova come gestore", subtitle: "10 minuti per scoprire come funziona", icon: "sparkles", color: .teal)
                    }.buttonStyle(SoftPressStyle())
                }
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.teal).accessibilityHidden(true)
                        TextField("Cerca stabilimento o città", text: $query).focused($searchFocused).autocorrectionDisabled().submitLabel(.search)
                        if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.accessibilityLabel("Cancella ricerca").buttonStyle(.plain) }
                    }.padding(.vertical, 9)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) { nearbyButton; allVenuesButton }
                        VStack(spacing: 10) { nearbyButton; allVenuesButton }
                    }.padding(.vertical, 4)
                    if let status = nearby.status { Text(status).font(.caption).foregroundStyle(.secondary) }
                } header: { Text("Dove vuoi giocare?") } footer: {
                    Text("Scegli lo stabilimento e accedi con le tue credenziali.")
                }
                if showingResults {
                    Section(nearbyOnly ? "Stabilimenti con posizione disponibile" : "Stabilimenti") {
                        if filtered.isEmpty {
                            Text(nearbyOnly ? "La ricerca vicina richiede la tua posizione e le coordinate dello stabilimento. Puoi sempre cercarlo per nome o città." : "Nessuno stabilimento trovato. Prova il nome o la città.").font(.subheadline).foregroundStyle(.secondary)
                        }
                        ForEach(Array(filtered.prefix(resultLimit))) { venue in
                            Button { searchFocused = false; Task { await store.choose(venue) } } label: {
                                HStack {
                                    Image(systemName: "mappin.and.ellipse").font(.title3).foregroundStyle(.blue).frame(width: 36, height: 36).background(.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                                    VStack(alignment: .leading) { Text(venue.name).font(.headline).foregroundStyle(.primary); if let city = venue.city, !city.isEmpty { Text(city).font(.caption).foregroundStyle(.secondary) } }
                                    Spacer(); if nearbyOnly, let distance = nearby.distance(venue) { Text(String(format: "%.1f km", distance)).font(.caption).foregroundStyle(.secondary) }; Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                                }.padding(.vertical, 8)
                            }.buttonStyle(SoftPressStyle()).disabled(store.busy)
                        }
                        if filtered.count > resultLimit { Button("Mostra altri stabilimenti") { resultLimit += 20 } }
                    }
                }
            }
            .campoSurface().navigationTitle("CampoPronto ADS").navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: query) { _, _ in resultLimit = 20; if !searchTerm.isEmpty { nearbyOnly = false } }
            .refreshable { await store.bootstrap() }
            .listSectionSpacing(.compact)
            .sheet(isPresented: $demo) { DemoWizard() }
            .sheet(isPresented: $venueRegistration) { VenueRegistrationWizard() }
        }
    }
    private func welcomeAction(_ title: String, subtitle: String, icon: String, color: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.title3).foregroundStyle(color)
                .frame(width: 42, height: 42).background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 15, style: .continuous)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(color).accessibilityHidden(true)
        }.padding(.vertical, 4)
    }
    private var nearbyButton: some View {
        Button {
            searchFocused = false; nearbyOnly = true; showAll = false; query = ""; resultLimit = 20; nearby.locate()
        } label: {
            Label("Vicini a me", systemImage: "location.fill").font(.subheadline.weight(.semibold)).padding(.horizontal, 14).padding(.vertical, 12)
                .foregroundStyle(.white).background(LinearGradient(colors: [.blue, .teal], startPoint: .leading, endPoint: .trailing), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        }.buttonStyle(SoftPressStyle())
    }
    private var allVenuesButton: some View {
        Button {
            searchFocused = false; nearbyOnly = false; showAll.toggle(); query = ""; resultLimit = 20
        } label: {
            Label(showAll ? "Nascondi elenco" : "Mostra tutti", systemImage: "list.bullet").font(.subheadline.weight(.semibold)).padding(.horizontal, 14).padding(.vertical, 12)
                .foregroundStyle(.blue).background(.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        }.buttonStyle(SoftPressStyle()).accessibilityLabel(showAll ? "Nascondi elenco" : "Mostra tutti gli stabilimenti")
    }

}
struct GalleryView: View {
    let photos: [Photo]
    @State private var expanded: Photo?
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        if !photos.isEmpty {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: typeSize.isAccessibilitySize ? 2 : min(4, photos.count)), spacing: 8) {
                ForEach(Array(photos.enumerated()), id: \.offset) { _, photo in
                    Button { expanded = photo } label: {
                        VStack(spacing: 3) {
                            AsyncImage(url: URL(string: photo.url)) { phase in
                                if let image = phase.image { image.resizable().scaledToFit() }
                                else { Image(systemName: phase.error == nil ? "photo" : "photo.badge.exclamationmark").foregroundStyle(.secondary) }
                            }
                            .padding(6).frame(maxWidth: .infinity).frame(height: 58)
                            .background(LinearGradient(colors: [.blue.opacity(0.05), .cyan.opacity(0.03)], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.blue.opacity(0.07), lineWidth: 0.5))
                            if let caption = photo.caption, !caption.isEmpty { Text(caption).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                        }.frame(maxWidth: .infinity)
                    }.buttonStyle(SoftPressStyle()).accessibilityLabel(photo.caption?.isEmpty == false ? photo.caption! : "Apri foto dello stabilimento")
                }
            }.padding(.vertical, 2)
            .sheet(isPresented: Binding(get: { expanded != nil }, set: { if !$0 { expanded = nil } })) {
                if let photo = expanded {
                    NavigationStack {
                        VStack(spacing: 16) {
                            AsyncImage(url: URL(string: photo.url)) { image in image.resizable().scaledToFit() } placeholder: { Image(systemName: "photo").font(.largeTitle).foregroundStyle(.secondary) }
                            if let caption = photo.caption { Text(caption).font(.subheadline) }
                            if let link = photo.link, let url = URL(string: link), ["https", "http"].contains(url.scheme?.lowercased() ?? "") { Link("Scopri di più", destination: url) }
                        }.padding().campoSurface().navigationTitle("Foto dello stabilimento").navigationBarTitleDisplayMode(.inline).toolbar { Button("Chiudi") { expanded = nil } }
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
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.95 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.28, dampingFraction: 0.68), value: configuration.isPressed)
    }
}
struct LoginView: View {
    @EnvironmentObject var store: BeachStore
    @State private var username = ""
    @State private var password = ""
    @State private var register = false
    @State private var venueRegistration = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 9) {
                        Image(systemName: "sportscourt.fill")
                            .font(.system(size: 27, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 60, height: 60)
                            .background(LinearGradient(colors: [.blue, .teal], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 21, style: .continuous))
                        Text(store.selected?.name ?? "CampoPronto").font(.title2.bold()).multilineTextAlignment(.center)
                        Text("Il tuo prossimo incontro parte da qui.").font(.subheadline).foregroundStyle(.secondary)
                        GalleryView(photos: store.config.gallery ?? [])
                    }.frame(maxWidth: .infinity).padding(.vertical, 8)
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Bentornato").font(.title3.bold())
                        Text("Accedi per scegliere il campo e prenotare.").font(.footnote).foregroundStyle(.secondary)
                        HStack(spacing: 12) {
                            Image(systemName: "person").foregroundStyle(.teal).frame(width: 22)
                            TextField("Username", text: $username).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                        }.padding(14).background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 15))
                        HStack(spacing: 12) {
                            Image(systemName: "lock").foregroundStyle(.teal).frame(width: 22)
                            SecureField("Password", text: $password).textContentType(.password)
                        }.padding(14).background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 15))
                        Button { Task { await store.login(username: username, password: password); if store.member != nil { password = "" } } } label: {
                            HStack { Spacer(); if store.busy { ProgressView().tint(.white) } else { Text("Accedi").bold(); Image(systemName: "arrow.right") }; Spacer() }
                                .padding(15).foregroundStyle(.white)
                                .background(LinearGradient(colors: [.blue, .teal], startPoint: .leading, endPoint: .trailing), in: RoundedRectangle(cornerRadius: 16))
                        }.buttonStyle(SoftPressStyle()).opacity(username.isEmpty || password.isEmpty ? 0.55 : 1).disabled(store.busy || username.isEmpty || password.isEmpty)
                        if store.config.registrationEnabled == true { Button("Crea un account") { register = true }.frame(maxWidth: .infinity).padding(.top, 2) }
                    }.padding(18).background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 24).stroke(.teal.opacity(0.10), lineWidth: 1))
                        .shadow(color: .black.opacity(0.04), radius: 12, y: 5)
                    VStack(spacing: 12) {
                        Button { venueRegistration = true } label: { Label("Registra il tuo stabilimento", systemImage: "building.2.crop.circle") }
                        Button("Richiedi recupero password") { Task { await store.perform { try await store.mutate("auth/recovery-request", body: ["username": username.trimmingCharacters(in: .whitespacesAndNewlines)]); store.message = "Se l’account esiste, la richiesta è stata inviata al gestore. Contattalo per il recupero." } } }.disabled(store.busy || username.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                        Link("Assistenza e privacy", destination: URL(string: "https://ombrelloni-ddb55.web.app/privacy.html")!).font(.caption)
                    }.font(.subheadline).padding(.vertical, 4)
                }.padding(.horizontal, 20).padding(.bottom, 20).frame(maxWidth: 560).frame(maxWidth: .infinity)
            }.scrollDismissesKeyboard(.interactively).campoSurface()

            .campoSurface().navigationTitle("Il tuo stabilimento").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Indietro") { store.selected = nil } } }
            .listSectionSpacing(.compact)
            .sheet(isPresented: $register) { RegisterView() }
            .sheet(isPresented: $venueRegistration) { VenueRegistrationWizard() }
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
            }.campoSurface().navigationTitle("Registrati").toolbar { Button("Chiudi") { dismiss() } }
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
            }.campoSurface().navigationTitle("Prova l’app").navigationBarTitleDisplayMode(.inline).toolbar { Button("Chiudi") { dismiss() }.disabled(store.busy) }
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
            if store.member?.isManager == true {
                shell { AgendaView() }.tabItem { Label("Agenda", systemImage: "calendar") }
                shell { BookingView() }.tabItem { Label("Prenota", systemImage: "sportscourt") }
                shell { UsersView() }.tabItem { Label("Utenti", systemImage: "person.2") }
                shell { ManagementView() }.tabItem { Label("Gestione", systemImage: "slider.horizontal.3") }
            } else {
                shell { BookingView() }.tabItem { Label("Prenota", systemImage: "sportscourt") }
                shell { MyBookingsView() }.tabItem { Label("Prenotazioni", systemImage: "calendar") }
                shell { CreditsView() }.tabItem { Label("Crediti", systemImage: "play.circle") }
                shell { CommunityView() }.tabItem { Label("Giocatori", systemImage: "person.2") }
            }
        }.tint(.blue).animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: store.member?.role).sheet(isPresented: $account) { AccountView() }
        .task {
            guard !adChecked, store.shouldShowLoginAd, store.member?.demo != true, store.member?.isManager != true else { return }; adChecked = true; store.shouldShowLoginAd = false
            do { let status: AdsStatus = try await store.request("ads/status"); if status.available { try await NativeAds.shared.showLoginAd() } } catch { /* Advertising must never prevent access. */ }
        }
    }
    func shell<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        NavigationStack {
            content().campoSurface().navigationBarTitleDisplayMode(.inline)
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
                HStack { VStack(alignment: .leading, spacing: 5) { Text("Ciao, \(store.member?.username ?? "")").font(.title3.bold()); Text(store.member?.isManager == true ? "Gestisci il tuo stabilimento" : "Pronto a giocare?").foregroundStyle(.secondary) }; Spacer(); Image(systemName: "sportscourt.fill").font(.largeTitle).foregroundStyle(.white).padding(12).background(.blue.gradient, in: RoundedRectangle(cornerRadius: 18)) }.padding(.vertical, 3)
                if store.member?.demo == true { Text("Stai provando come \(store.member?.isManager == true ? "gestore" : "utente"). Usa il pulsante in alto a sinistra per cambiare ruolo.").font(.footnote).foregroundStyle(.orange) }
                GalleryView(photos: store.config.gallery ?? [])
            }
            Section {
                NavigationLink { BookingView() } label: { Label("Prenota un campo", systemImage: "calendar.badge.plus").font(.headline) }
                if store.member?.isManager == true { NavigationLink { CommunityView() } label: { Label("Giocatori e lista d’attesa", systemImage: "person.2") }; NavigationLink { MyBookingsView() } label: { Label("Le mie prenotazioni", systemImage: "calendar") } }
                if store.member?.managementMode != true { NavigationLink { CreditsView() } label: { HStack { Label("I tuoi crediti", systemImage: "circle.hexagongrid"); Spacer(); Text("\(store.member?.credits ?? 0)").font(.title3.bold()).foregroundStyle(.blue) } } }
            }
            if let next = store.mine.sorted(by: { $0.date + $0.time < $1.date + $1.time }).first {
                Section("La tua prossima partita") { BookingRow(booking: next) }
            }
            if store.selected?.id == "tommi38" { Section { WeatherSummaryView() } }
            if let notes = store.config.notesText, !notes.isEmpty { Section { DisclosureGroup("Dal tuo stabilimento") { Text(notes).font(.subheadline) } } }
            Section { DisclosureGroup("Come funziona") { Text("Un credito permette una prenotazione. Scegli il campo e un orario libero. Se è occupato, puoi entrare in lista d’attesa.").font(.footnote).foregroundStyle(.secondary) } }
        }.listSectionSpacing(.compact).contentMargins(.top, 6, for: .scrollContent).refreshable { await store.perform { try await store.refresh() } }
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
        NavigationStack { Form { Stepper("\(count) giocatori cercati", value: $count, in: 1...12); TextField("Messaggio (facoltativo)", text: $note, axis: .vertical); Text("Pubblica solo informazioni che vuoi condividere con gli utenti dello stabilimento. Non inserire dati sensibili.").font(.caption).foregroundStyle(.secondary); Button("Pubblica ricerca") { Task { await store.perform { try await store.mutate("player-searches", body: ["reservationId": booking.id, "spotsNeeded": count, "note": note]); dismiss() } } }.disabled(store.busy || note.count > 200) }.campoSurface().navigationTitle("Cerco giocatori").toolbar { Button("Chiudi") { dismiss() } } }
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
        }.campoSurface().navigationTitle("Giocatori")
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
            }.campoSurface().navigationTitle("Il tuo account").toolbar { Button("Chiudi") { dismiss() } }
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
        }.campoSurface().navigationTitle("Password")
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
        }.campoSurface().navigationTitle("Utenti bloccati").task { await store.perform { try await load() } }.refreshable { await store.perform { try await load() } }
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
    @State private var loading = true
    private func weather(_ code: Int) -> (symbol: String, label: String) {
        switch code {
        case 0: return ("sun.max.fill", "Sereno")
        case 1, 2: return ("cloud.sun.fill", "Poco nuvoloso")
        case 3: return ("cloud.fill", "Nuvoloso")
        case 45, 48: return ("cloud.fog.fill", "Nebbia")
        case 51...57: return ("cloud.drizzle.fill", "Pioviggine")
        case 61...67, 80...82: return ("cloud.rain.fill", "Pioggia")
        case 71...77, 85, 86: return ("cloud.snow.fill", "Neve")
        case 95...99: return ("cloud.bolt.rain.fill", "Temporale")
        default: return ("cloud.fill", "Meteo")
        }
    }
    private func dayLabel(_ day: String, index: Int) -> String {
        if index == 0 { return "Oggi" }
        if index == 1 { return "Domani" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "it_IT")
        formatter.timeZone = TimeZone(identifier: "Europe/Rome")
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: day) else { return day }
        formatter.dateFormat = "EEE"
        return formatter.string(from: date).capitalized
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Meteo · area Tommi38", systemImage: "sun.max").font(.subheadline.weight(.semibold))
            if let daily = forecast?.daily {
                let count = min(3, daily.time.count, daily.weathercode.count, daily.temperature_2m_max.count, daily.temperature_2m_min.count)
                HStack(alignment: .top, spacing: 8) {
                    ForEach(0..<count, id: \.self) { index in
                        let condition = weather(daily.weathercode[index])
                        VStack(spacing: 6) {
                            Text(dayLabel(daily.time[index], index: index)).font(.caption.weight(.semibold))
                            Image(systemName: condition.symbol).symbolRenderingMode(.multicolor).font(.title2).frame(height: 30)
                            Text("\(Int(daily.temperature_2m_max[index].rounded()))° / \(Int(daily.temperature_2m_min[index].rounded()))°").font(.caption.weight(.medium)).monospacedDigit()
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(.teal.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(dayLabel(daily.time[index], index: index)), \(condition.label), massima \(Int(daily.temperature_2m_max[index].rounded())) gradi, minima \(Int(daily.temperature_2m_min[index].rounded())) gradi")
                    }
                }
                if count == 0 { Text("Previsioni non disponibili").font(.caption).foregroundStyle(.secondary) }
            } else if loading {
                ProgressView("Carico il meteo…").font(.caption)
            } else {
                Text("Previsioni non disponibili al momento").font(.caption).foregroundStyle(.secondary)
                Button("Riprova") { Task { await load() } }.font(.caption)
            }
        }.task { await load() }
    }
    private func load() async {
        loading = true
        defer { loading = false }
        forecast = try? await store.request("weather")
    }
}

struct RegistrationCredential: Decodable { let username: String; let password: String }
struct VenueRegistrationResult: Decodable {
    let establishmentId: String; let name: String; let status: String
    let manager: RegistrationCredential; let credentials: [RegistrationCredential]
}
struct VenueRegistrationWizard: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var setup: DemoSetup = { var value = DemoSetup(); value.name = ""; return value }()
    @State private var city = ""
    @State private var manager = "gestore"
    @State private var password = ""
    @State private var prefix = "user"
    @State private var count = 10
    @State private var step = 0
    @State private var requestID = UUID().uuidString
    @State private var result: VenueRegistrationResult?
    @State private var document: URL?
    @State private var failure: String?
    @State private var submitting = false
    var validFields: Bool { setup.name.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 && !setup.fields.isEmpty && setup.fields.allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } && Set(setup.fields.map { $0.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) }).count == setup.fields.count }
    var validHours: Bool { Clock.validTime(setup.dayStart) && Clock.validTime(setup.dayEnd) && Clock.minutes(setup.dayEnd)-Clock.minutes(setup.dayStart) >= setup.slotMinutes }
    var validAccount: Bool { manager.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$", options: .regularExpression) != nil && password.count >= 12 && password.utf8.count <= 72 && prefix.range(of: "^[A-Za-z][A-Za-z0-9_-]{0,19}$", options: .regularExpression) != nil && !(1...count).contains { prefix + String(format: "%03d", $0) == manager } }
    var canContinue: Bool { step == 0 ? validFields : step == 1 ? validHours : validAccount }
    var body: some View {
        NavigationStack {
            Form {
                if let result {
                    Section {
                        Label("Stabilimento creato", systemImage: "checkmark.seal.fill").font(.headline).foregroundStyle(.blue)
                        Text(result.name).bold()
                        Text("È già attivo. Il gestore può amministrare solo questo stabilimento; l’amministratore globale mantiene il controllo della piattaforma.").font(.subheadline)
                        Text("\(result.credentials.count) utenti numerati, tutti con zero crediti.").font(.subheadline)
                    }
                    Section("Credenziali") {
                        Text("Gestore: \(result.manager.username)")
                        Text("Utenti: \(result.credentials.first?.username ?? "") – \(result.credentials.last?.username ?? "")")
                        Text("Le credenziali vengono mostrate una sola volta. Salva il PDF prima di chiudere: contiene anche le password alfanumeriche di 6 caratteri degli utenti.").font(.footnote).foregroundStyle(.secondary)
                        if let document { ShareLink(item: document) { Label("Salva o condividi il PDF", systemImage: "square.and.arrow.up") } }
                        else { Button("Prepara il PDF") { makeDocument(result) } }
                    }
                    Section { Button("Ho salvato il PDF · Accedi") { Task { await store.choose(Venue(id: result.establishmentId, name: result.name)); dismiss() } } }
                } else {
                    Section {
                        ProgressView(value: Double(step + 1), total: 3).tint(.blue)
                        Text("Passo \(step + 1) di 3").font(.caption).foregroundStyle(.secondary).contentTransition(.numericText())
                    }
                    if step == 0 {
                        Section("Il tuo stabilimento") { TextField("Nome dello stabilimento", text: $setup.name); TextField("Città", text: $city) }
                        Section("Campi") {
                            ForEach(setup.fields.indices, id: \.self) { i in TextField("Nome campo \(i + 1)", text: $setup.fields[i]) }
                            if setup.fields.count < 6 { Button("Aggiungi campo") { setup.fields.append("Campo \(setup.fields.count + 1)") } }
                            if setup.fields.count > 1 { Button("Rimuovi ultimo campo", role: .destructive) { setup.fields.removeLast() } }
                        }
                    } else if step == 1 {
                        Section("Quando si può prenotare?") {
                            TextField("Apertura HH:mm", text: $setup.dayStart).keyboardType(.numbersAndPunctuation)
                            TextField("Chiusura HH:mm", text: $setup.dayEnd).keyboardType(.numbersAndPunctuation)
                            Picker("Durata prenotazione", selection: $setup.slotMinutes) { ForEach([15,30,40,45,60,90], id: \.self) { Text("\($0) minuti").tag($0) } }
                            Button("Usa orari di base") { setup.dayStart = "09:00"; setup.dayEnd = "20:00"; setup.slotMinutes = 45 }
                        }
                    } else {
                        Section("Il tuo account gestore") {
                            TextField("Username gestore", text: $manager).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.username)
                            SecureField("Password gestore · almeno 12 caratteri", text: $password).textContentType(.newPassword)
                        }
                        Section("Quanti utenti vuoi creare?") {
                            Stepper("\(count) utenti", value: $count, in: 1...100)
                            TextField("Prefisso utenti", text: $prefix).textInputAutocapitalization(.never).autocorrectionDisabled()
                            Text("Da \(prefix)001 a \(prefix)\(String(format: "%03d", count)). Password casuali alfanumeriche di 6 caratteri, riportate nel PDF.").font(.footnote).foregroundStyle(.secondary)
                            Text("Tutti partono con zero crediti. Un video premio verificato permette di ottenere un credito, secondo disponibilità e limiti giornalieri.").font(.footnote)
                        }
                        Section("Riepilogo") {
                            Text(setup.name).bold(); Text(setup.fields.joined(separator: " · ")); Text("\(setup.dayStart)–\(setup.dayEnd) · \(setup.slotMinutes) minuti")
                            Text("Lo stabilimento sarà attivo subito e visibile nella ricerca per nome e città. Il gestore ha accesso solo ai propri dati.").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    if let failure { Section { Text(failure).font(.footnote).foregroundStyle(.red) } }
                    Section {
                        Button { if step < 2 { withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.82)) { step += 1 } } else { Task { await create() } } } label: { HStack { Spacer(); if submitting { ProgressView("Creo stabilimento e utenti…") } else { Text(step < 2 ? "Continua" : "Crea stabilimento e PDF").bold() }; Spacer() } }.disabled(!canContinue || submitting)
                        if step > 0 { Button("Indietro") { withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.82)) { step -= 1 } }.disabled(submitting) }
                    }
                }
            }.listSectionSpacing(.compact).campoSurface().navigationTitle("Registra stabilimento").navigationBarTitleDisplayMode(.inline)
                .toolbar { if result == nil { Button("Chiudi") { dismiss() }.disabled(submitting) } }
                .interactiveDismissDisabled(submitting || result != nil)
                .onAppear {
                    #if DEBUG
                    if ProcessInfo.processInfo.environment["CAMPOPRONTO_PDF_PREVIEW"] == "1" {
                        let sample = VenueRegistrationResult(establishmentId: "sample-preview", name: "Esempio PDF · nessun account reale", status: "active", manager: RegistrationCredential(username: "gestore", password: "Fixture-manager-2026!"), credentials: (1...100).map { RegistrationCredential(username: "user" + String(format: "%03d", $0), password: "Test01") })
                        result = sample; makeDocument(sample)
                    }
                    #endif
                }
                .onDisappear { password = ""; result = nil; if let document { try? FileManager.default.removeItem(at: document) } }
        }
    }
    func create() async {
        guard validFields && validHours && validAccount && !submitting else { return }
        submitting = true; failure = nil; defer { submitting = false }
        do {
            let response: VenueRegistrationResult = try await store.request("venue-registration", method: "POST", body: ["requestId": requestID, "name": setup.name, "city": city, "managerUsername": manager, "managerPassword": password, "fields": setup.fields, "dayStart": setup.dayStart, "dayEnd": setup.dayEnd, "slotMinutes": setup.slotMinutes, "userCount": count, "userPrefix": prefix])
            if !store.venues.contains(where: { $0.id == response.establishmentId }) { store.venues.append(Venue(id: response.establishmentId, name: response.name, city: city)) }
            result = response; password = ""; makeDocument(response)
        } catch { failure = error.localizedDescription }
    }
    func makeDocument(_ value: VenueRegistrationResult) {
        do { document = try RegistrationPDF.write(value) }
        catch { failure = "Stabilimento creato, ma non riesco a preparare il PDF. Premi Prepara il PDF per riprovare." }
    }
}
@MainActor
enum RegistrationPDF {
    static func write(_ result: VenueRegistrationResult) throws -> URL {
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 595, height: 842))
        let data = renderer.pdfData { context in
            var y: CGFloat = 0
            var pageNumber = 0
            func text(_ value: String, at point: CGPoint, size: CGFloat = 13, bold: Bool = false, width: CGFloat = 507) {
                (value as NSString).draw(in: CGRect(x: point.x, y: point.y, width: width, height: 60), withAttributes: [.font: bold ? UIFont.boldSystemFont(ofSize: size) : UIFont.systemFont(ofSize: size), .foregroundColor: UIColor.black])
            }
            func page() {
                context.beginPage(); pageNumber += 1
                text("CampoPronto ADS · Credenziali", at: CGPoint(x: 44,y: 38), size: 20, bold: true)
                text(result.name, at: CGPoint(x: 44,y: 75), size: 15, bold: true)
                let titleHeight = (result.name as NSString).boundingRect(with: CGSize(width:507,height:60), options:.usesLineFragmentOrigin, attributes:[.font:UIFont.boldSystemFont(ofSize:15)], context:nil).height
                let statusY = 75 + ceil(titleHeight) + 12
                text("Stabilimento attivo e ricercabile · Zero crediti iniziali", at: CGPoint(x: 44,y: statusY), size: 10)
                text("Pagina \(pageNumber)", at: CGPoint(x: 44,y: 802), size: 10)
                y = statusY + 32
            }
            func columns() {
                text("N.", at:CGPoint(x:44,y:y),size:10,bold:true)
                text("Nome utente", at:CGPoint(x:100,y:y),size:10,bold:true)
                text("Password", at:CGPoint(x:350,y:y),size:10,bold:true)
                y += 25
            }
            page()
            text("Account gestore (password scelta durante la registrazione)", at: CGPoint(x: 44,y:y), bold:true); y += 30
            text("Username: \(result.manager.username)", at: CGPoint(x:44,y:y)); y += 26
            text("Password: \(result.manager.password)", at: CGPoint(x:44,y:y), size:11); y += 52
            text("Invito: campopronto://venue?id=\(result.establishmentId)", at: CGPoint(x:44,y:y),size:10); y += 46
            columns()
            for (index, credential) in result.credentials.enumerated() {
                if y > 735 { page(); columns() }
                text(String(format:"%03d",index+1), at:CGPoint(x:44,y:y),size:12)
                text(credential.username, at:CGPoint(x:100,y:y),bold:true,width:220)
                text(credential.password, at:CGPoint(x:350,y:y),width:150); y += 26
            }
            if y > 704 { page() }
            text("Un credito = una prenotazione. Gli utenti ottengono crediti dai video premio verificati.\nConserva il documento e consegna a ciascun utente soltanto le proprie credenziali.", at:CGPoint(x:44,y:y+12),size:10)
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("CampoPronto-credenziali-\(UUID().uuidString).pdf")
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }
}

struct CampoSurface: ViewModifier {
    func body(content: Content) -> some View {
        content.scrollContentBackground(.hidden)
            .background {
                LinearGradient(colors: [Color(.systemGroupedBackground), Color.teal.opacity(0.08), Color.blue.opacity(0.06)], startPoint: .topLeading, endPoint: .bottomTrailing).ignoresSafeArea()
            }
    }
}
extension View {
    func campoSurface() -> some View { modifier(CampoSurface()) }
}

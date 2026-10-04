# CampoPronto ADS 2.1 (56)

Cliente reale: interstitial nel passaggio di accesso, video premio volontario per un credito verificato e banner persistente sopra tutte le schede cliente. Interstitial conserva limite locale e AdMob 1/30 minuti. La sessione ripristinata non mostra un nuovo interstitial. Manager e demo restano senza annunci.

Creato e verificato su AdMob il blocco «CampoPronto ADS iOS - Banner superiore»: ca-app-pub-5793073160443124/8892398136. Banner compatto 320×50, centrato sotto safe area, separato dai comandi e identificato «Pubblicità». Un'unica istanza sopra il TabView mantiene il banner anche durante navigazione e cambio scheda. Richieste non personalizzate, dopo consenso UMP. Nessun credito da banner o interstitial. Mancanza annunci o errori non impediscono accesso. Durante l'annuncio di ingresso la schermata di transizione evita un'apparizione tardiva sopra contenuti già utilizzabili.

Verifiche: banner Google di test ricevuto sul simulatore iPhone 18 Pro Max con account dimostrativo user004. Nome stabilimento, Account e navigazione visibili; aprendo Crediti il banner persiste. Cinque test dei premi AdMob superati: SSV firmata, un credito per video, isolamento stabilimento e protezione da duplicati. Debug e archivio Release firmato riusciti. Nessun clic su banner, nessun annuncio di produzione utilizzato per test. Build include registrazione fino a 1.000 clienti della 55. Desktop sincronizzato.

Screenshot nel workspace: artifacts/campopronto-native-2.1-build56/admob-banner-creato.png e banner-home-iphone.png. L'erogazione reale dipende da consenso, disponibilità e AdMob; gli annunci di test non generano guadagni.

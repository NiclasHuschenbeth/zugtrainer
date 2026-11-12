// Kleines Beispiel-Repertoire (Weiß, 1.e4) zum Ausprobieren.
export const SAMPLE_NAME = 'Beispiel: 1.e4 für Weiß';
export const SAMPLE_COLOR = 'white';
export const SAMPLE_PGN = `
[Event "Italienisch: Giuoco Piano"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 { Der Läufer zielt auf den schwachen Punkt f7. } 3... Bc5 4. c3 { Bereitet d2-d4 vor: Weiß will das Zentrum besetzen. } 4... Nf6
( 4... d6 5. d4 exd4 6. cxd4 Bb6 7. Nc3 { Weiß hat das ideale Bauernzentrum. } )
5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 { Der Möller-Angriff: Weiß opfert einen Bauern für Entwicklung. } 7... Nxe4 8. O-O Bxc3 9. d5 { Die Pointe! Der Läufer c3 läuft nicht weg. } 9... Bf6 10. Re1 Ne7 11. Rxe4 d6 12. Bg5 Bxg5 13. Nxg5 *

[Event "Zweispringerspiel im Nachzug"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 { Die ruhige, solide Fortsetzung. } 4... Bc5
( 4... Be7 5. O-O O-O 6. Re1 d6 7. a4 { Sichert dem Läufer das Feld a2. } )
5. c3 d6 6. O-O O-O 7. Re1 a6 8. Bb3 *

[Event "Russisch und Philidor"]

1. e4 e5 2. Nf3 Nf6
( 2... d6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Be7 6. Bf4 { Mit der Idee Dd2 und lange Rochade. } )
3. Nxe5 d6 4. Nf3 Nxe4 5. d4 d5 6. Bd3 *

[Event "Sizilianisch: Alapin"]

1. e4 c5 2. c3 { Alapin: Weiß will mit d2-d4 ein Zentrum aufbauen. } 2... Nf6
( 2... d5 3. exd5 Qxd5 4. d4 Nf6 5. Nf3 e6 6. Be3 )
3. e5 Nd5 4. d4 cxd4 5. Nf3 Nc6 6. cxd4 d6 7. Bc4 *
`;

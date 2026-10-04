// The Bar Book's starter list: well-known drinks (the classic cocktail canon
// and the everyday bar calls), so the book isn't empty on day one. Specs are
// common bar proportions in ounces; the descriptions and methods are written
// in our own words. Our menu's own recipes and our house drinks sit on top
// of these: a menu drink with the same name wins.
//
// scripts/seed-bar-book.mjs puts these in the database (recipes with no
// menu item, source 'seed'), adding any ingredient we don't have yet as not
// carried. scripts/check-bar-book.mjs checks the list. Plain data with
// type-only imports, so plain node can read it.
import type { Family, GlassKey, Ice, Kind, Method } from "@/lib/bar/icons";

export interface SeedIngredient {
  kind: Kind;
  family: Family;
  unit: "oz" | "count";
  // Other names the bar may already have it under: "Well Vodka" is Vodka.
  // The seed script also ignores "well", "house" and "fresh" in front.
  aliases?: string[];
}

const oz = (kind: Kind, family: Family, aliases?: string[]): SeedIngredient => ({ kind, family, unit: "oz", aliases });
const ct = (kind: Kind, family: Family, aliases?: string[]): SeedIngredient => ({ kind, family, unit: "count", aliases });

export const SEED_INGREDIENTS: Record<string, SeedIngredient> = {
  // spirits
  Vodka: oz("spirit", "vodka"),
  Gin: oz("spirit", "gin", ["london dry gin"]),
  "White rum": oz("spirit", "rum", ["rum", "light rum", "silver rum", "bacardi"]),
  "Dark rum": oz("spirit", "rum", ["meyers", "myers's", "black rum"]),
  "Coconut rum": oz("spirit", "rum", ["malibu"]),
  Tequila: oz("spirit", "tequila", ["blanco tequila", "silver tequila"]),
  Bourbon: oz("spirit", "whiskey", ["bourbon whiskey"]),
  "Rye whiskey": oz("spirit", "whiskey", ["rye"]),
  Whiskey: oz("spirit", "whiskey", ["whisky", "blended whiskey"]),
  "Irish whiskey": oz("spirit", "whiskey", ["jameson"]),
  Scotch: oz("spirit", "whiskey", ["scotch whisky", "blended scotch"]),
  "Seagram's 7": oz("spirit", "whiskey", ["seagram's seven", "seagrams seven", "seagrams 7"]),
  "Cinnamon whiskey": oz("spirit", "whiskey", ["fireball"]),
  Brandy: oz("spirit", "brandy", ["cognac"]),
  Pisco: oz("spirit", "brandy"),
  Cachaça: oz("spirit", "rum", ["cachaca"]),
  // liqueurs and fortified wine
  "Triple sec": oz("liqueur", "liqueur", ["orange liqueur"]),
  Cointreau: oz("liqueur", "liqueur"),
  "Blue curaçao": oz("liqueur", "liqueur", ["blue curacao"]),
  Amaretto: oz("liqueur", "liqueur", ["disaronno"]),
  "Coffee liqueur": oz("liqueur", "coffee", ["kahlua", "kahlúa"]),
  "Irish cream": oz("liqueur", "cream", ["baileys", "bailey's"]),
  "Peach schnapps": oz("liqueur", "liqueur"),
  "Sour apple schnapps": oz("liqueur", "liqueur", ["apple pucker", "sour apple pucker"]),
  "Raspberry liqueur": oz("liqueur", "liqueur", ["chambord"]),
  "Crème de cacao": oz("liqueur", "liqueur", ["creme de cacao", "white creme de cacao"]),
  "Crème de menthe": oz("liqueur", "liqueur", ["creme de menthe", "green creme de menthe"]),
  "Crème de cassis": oz("liqueur", "liqueur", ["creme de cassis"]),
  "Crème de violette": oz("liqueur", "liqueur", ["creme de violette"]),
  "Maraschino liqueur": oz("liqueur", "liqueur", ["luxardo maraschino"]),
  "Green Chartreuse": oz("liqueur", "liqueur", ["chartreuse"]),
  Bénédictine: oz("liqueur", "liqueur", ["benedictine"]),
  Drambuie: oz("liqueur", "liqueur"),
  Galliano: oz("liqueur", "liqueur"),
  "Southern Comfort": oz("liqueur", "liqueur"),
  "Sloe gin": oz("liqueur", "liqueur"),
  "Licor 43": oz("liqueur", "liqueur"),
  Jägermeister: oz("liqueur", "liqueur", ["jagermeister", "jager"]),
  Aperol: oz("liqueur", "grapefruit"),
  Campari: oz("liqueur", "vermouth"),
  Amaro: oz("liqueur", "liqueur", ["amaro nonino"]),
  "Lillet Blanc": oz("liqueur", "ginger", ["lillet"]),
  "Sweet vermouth": oz("liqueur", "vermouth", ["red vermouth", "rosso vermouth"]),
  "Dry vermouth": oz("liqueur", "vermouth", ["white vermouth", "extra dry vermouth"]),
  Absinthe: oz("liqueur", "liqueur", ["herbsaint", "pastis"]),
  // bitters
  "Angostura bitters": oz("bitters", "vermouth", ["bitters", "aromatic bitters"]),
  "Orange bitters": oz("bitters", "vermouth"),
  "Peychaud's bitters": oz("bitters", "vermouth", ["peychauds bitters", "peychaud's"]),
  // juices
  "Lime juice": oz("juice", "citrus"),
  "Lemon juice": oz("juice", "citrus"),
  "Orange juice": oz("juice", "syrup", ["oj"]),
  "Grapefruit juice": oz("juice", "grapefruit"),
  "Cranberry juice": oz("juice", "grapefruit", ["cranberry"]),
  "Pineapple juice": oz("juice", "ginger"),
  "Tomato juice": oz("juice", "grapefruit", ["bloody mary mix"]),
  "Grape juice": oz("juice", "grapefruit"),
  Lemonade: oz("juice", "citrus"),
  "Peach purée": oz("juice", "syrup", ["peach puree"]),
  "Strawberry purée": oz("juice", "grapefruit", ["strawberry puree"]),
  // syrups
  "Simple syrup": oz("syrup", "syrup", ["sugar syrup", "simple"]),
  "Honey syrup": oz("syrup", "syrup"),
  "Agave syrup": oz("syrup", "syrup", ["agave nectar", "agave"]),
  Grenadine: oz("syrup", "grapefruit"),
  Orgeat: oz("syrup", "syrup", ["orgeat syrup", "almond syrup"]),
  "Raspberry syrup": oz("syrup", "grapefruit"),
  "Ginger syrup": oz("syrup", "ginger"),
  "Passion fruit syrup": oz("syrup", "syrup", ["passion fruit"]),
  "Cream of coconut": oz("syrup", "cream", ["coco lopez", "coconut cream"]),
  // mixers
  Cola: oz("mixer", "cola", ["coke", "coca-cola", "coca cola", "pepsi", "fountain coke"]),
  "Lemon-lime soda": oz("mixer", "soda", ["sprite", "7up", "7-up", "starry"]),
  "Ginger ale": oz("mixer", "ginger"),
  "Ginger beer": oz("mixer", "ginger"),
  "Tonic water": oz("mixer", "soda", ["tonic"]),
  "Soda water": oz("mixer", "soda", ["club soda", "seltzer", "sparkling water"]),
  "Sour mix": oz("mixer", "citrus", ["sweet and sour", "sweet & sour", "sweet and sour mix", "sweet & sour mix"]),
  "Energy drink": oz("mixer", "syrup", ["red bull"]),
  "Iced tea": oz("mixer", "syrup", ["sweet tea", "unsweetened iced tea"]),
  "Hot coffee": oz("mixer", "coffee", ["coffee", "drip coffee", "brewed coffee"]),
  Espresso: oz("mixer", "coffee", ["espresso shot"]),
  "Hot water": oz("other", "soda"),
  "Heavy cream": oz("mixer", "cream", ["cream", "half and half", "half & half"]),
  "Olive brine": oz("mixer", "soda"),
  "Worcestershire sauce": oz("other", "cola", ["worcestershire"]),
  "Hot sauce": oz("other", "grapefruit", ["tabasco", "cholula", "valentina"]),
  // wine and beer
  Prosecco: oz("wine", "ginger", ["sparkling wine", "champagne", "cava", "brut"]),
  "Red wine": oz("wine", "wine", ["house red"]),
  "White wine": oz("wine", "ginger", ["house white"]),
  "Mexican lager": oz("beer", "beer", ["lager", "corona", "modelo", "pacifico"]),
  Stout: oz("beer", "beer", ["guinness"]),
  "Light beer": oz("beer", "beer", ["beer", "draft lager", "bud light", "budweiser", "coors light"]),
  // counted
  "Mint leaves": ct("garnish", "citrus", ["mint", "fresh mint"]),
  "Lime wedges": ct("garnish", "citrus", ["lime wedge", "limes"]),
  "Jalapeño slices": ct("garnish", "citrus", ["jalapeno", "jalapeño", "jalapenos"]),
  "Egg white": ct("other", "cream", ["egg whites"]),
  Salt: ct("garnish", "soda", ["kosher salt", "margarita salt"]),
};

export interface SeedLine {
  name: string; // a key of SEED_INGREDIENTS
  amount: number; // oz, or a count for counted ingredients
  optional?: boolean; // never stops the drink being made
}

export interface SeedDrink {
  name: string;
  glass: GlassKey;
  method: Method;
  ice: Ice;
  garnishes: string[];
  description: string;
  instructions: string;
  ingredients: SeedLine[];
}

type Line = [name: string, amount: number, optional?: "opt"];

function d(name: string, glass: GlassKey, method: Method, ice: Ice, garnishes: string[], lines: Line[], description: string, instructions: string): SeedDrink {
  return { name, glass, method, ice, garnishes, description, instructions, ingredients: lines.map(([n, amount, opt]) => ({ name: n, amount, ...(opt ? { optional: true } : {}) })) };
}

const DASH = 0.03; // a dash of bitters, in oz

export const SEED_DRINKS: SeedDrink[] = [
  // ---------- whiskey ----------
  d("Old Fashioned", "rocks", "stir", "cubes", ["Orange peel", "Cherry"], [["Bourbon", 2], ["Simple syrup", 0.25], ["Angostura bitters", DASH * 2]], "Bourbon, a little sugar and bitters: the original idea of a cocktail.", "Stir everything with ice until very cold. Strain over a big cube and twist the orange peel over the top."),
  d("Manhattan", "coupe", "stir", "none", ["Cherry"], [["Rye whiskey", 2], ["Sweet vermouth", 1], ["Angostura bitters", DASH * 2]], "Rye and sweet vermouth, stirred and served up. Rich and a little spicy.", "Stir with ice for about 20 seconds and strain into a chilled coupe. Drop in the cherry."),
  d("Rob Roy", "coupe", "stir", "none", ["Cherry"], [["Scotch", 2], ["Sweet vermouth", 1], ["Angostura bitters", DASH * 2]], "A Manhattan made with Scotch, so it's smokier and drier.", "Stir with ice and strain into a chilled coupe. Garnish with a cherry."),
  d("Whiskey Sour", "rocks", "shake", "cubes", ["Cherry", "Orange slice"], [["Bourbon", 2], ["Lemon juice", 0.75], ["Simple syrup", 0.75], ["Egg white", 1, "opt"]], "Bourbon, lemon and sugar in balance. Egg white makes it silky if the guest wants it.", "Shake hard with ice (shake once without ice first if using egg white). Strain over fresh ice."),
  d("New York Sour", "rocks", "shake", "cubes", ["Lemon peel"], [["Rye whiskey", 2], ["Lemon juice", 0.75], ["Simple syrup", 0.75], ["Red wine", 0.5]], "A whiskey sour with a layer of red wine floating on top.", "Shake the rye, lemon and syrup with ice and strain over fresh ice. Pour the wine slowly over a spoon so it floats."),
  d("Gold Rush", "rocks", "shake", "cubes", ["Lemon twist"], [["Bourbon", 2], ["Lemon juice", 0.75], ["Honey syrup", 0.75]], "A whiskey sour sweetened with honey instead of sugar.", "Shake with ice and strain over a big cube."),
  d("Whiskey Smash", "rocks", "shake", "crushed", ["Mint sprig", "Lemon wheel"], [["Bourbon", 2], ["Lemon juice", 0.75], ["Simple syrup", 0.75], ["Mint leaves", 6]], "Bourbon shaken with lemon and fresh mint over crushed ice.", "Lightly press the mint in the shaker, add the rest and shake with ice. Strain over crushed ice."),
  d("Mint Julep", "rocks", "build", "crushed", ["Mint sprig"], [["Bourbon", 2.5], ["Simple syrup", 0.5], ["Mint leaves", 8]], "Bourbon, sugar and mint packed with crushed ice. The Derby drink.", "Gently press the mint with the syrup in the glass. Add bourbon, pack with crushed ice and stir until frosty."),
  d("Sazerac", "rocks", "stir", "none", ["Lemon peel"], [["Rye whiskey", 2], ["Simple syrup", 0.25], ["Peychaud's bitters", DASH * 3], ["Absinthe", 0.1]], "New Orleans rye with Peychaud's bitters in an absinthe-rinsed glass, no ice.", "Swirl the absinthe around a chilled glass and pour it out. Stir the rest with ice and strain into the glass."),
  d("Vieux Carré", "rocks", "stir", "cubes", ["Lemon peel"], [["Rye whiskey", 0.75], ["Brandy", 0.75], ["Sweet vermouth", 0.75], ["Bénédictine", 0.25], ["Angostura bitters", DASH], ["Peychaud's bitters", DASH]], "Rye, brandy and vermouth with a touch of herbal liqueur. Rich and smooth.", "Stir with ice and strain over a big cube."),
  d("Boulevardier", "rocks", "stir", "cubes", ["Orange peel"], [["Bourbon", 1.5], ["Campari", 1], ["Sweet vermouth", 1]], "A Negroni made with bourbon instead of gin. Bitter-sweet and warm.", "Stir with ice and strain over a big cube."),
  d("Paper Plane", "coupe", "shake", "none", [], [["Bourbon", 0.75], ["Aperol", 0.75], ["Amaro", 0.75], ["Lemon juice", 0.75]], "Four equal parts: bourbon, Aperol, amaro and lemon.", "Shake with ice and strain into a chilled coupe."),
  d("Penicillin", "rocks", "shake", "cubes", [], [["Scotch", 2], ["Lemon juice", 0.75], ["Honey syrup", 0.4], ["Ginger syrup", 0.4]], "Scotch with lemon, honey and ginger. Soothing with a little bite.", "Shake with ice and strain over a big cube."),
  d("Rusty Nail", "rocks", "build", "cubes", ["Lemon twist"], [["Scotch", 2], ["Drambuie", 0.5]], "Scotch sweetened with honeyed Drambuie.", "Build over ice and give it a short stir."),
  d("Godfather", "rocks", "build", "cubes", [], [["Scotch", 2], ["Amaretto", 0.5]], "Scotch softened with almond liqueur.", "Build over ice and stir."),
  d("Whiskey & Coke", "highball", "build", "cubes", [], [["Whiskey", 2], ["Cola", 4]], "Whiskey topped with cola. Every bar's most-called highball.", "Pour the whiskey over ice and top with cola."),
  d("Whiskey Ginger", "highball", "build", "cubes", ["Lime wedge"], [["Whiskey", 2], ["Ginger ale", 4]], "Whiskey and ginger ale with a squeeze of lime.", "Pour the whiskey over ice, top with ginger ale and squeeze in the lime."),
  d("Seven & Seven", "highball", "build", "cubes", ["Lemon wedge"], [["Seagram's 7", 2], ["Lemon-lime soda", 4]], "Seagram's 7 whiskey with lemon-lime soda.", "Pour over ice and top with the soda."),
  d("Kentucky Mule", "mug", "build", "cubes", ["Lime wheel", "Mint sprig"], [["Bourbon", 2], ["Lime juice", 0.5], ["Ginger beer", 4]], "A Moscow Mule made with bourbon.", "Fill the mug with ice, add bourbon and lime, and top with ginger beer."),
  d("Irish Coffee", "mug", "build", "none", ["Whipped cream"], [["Irish whiskey", 1.5], ["Hot coffee", 4], ["Simple syrup", 0.5], ["Heavy cream", 1]], "Hot coffee, Irish whiskey and a little sugar under a cap of cream.", "Warm the mug. Stir whiskey, syrup and coffee, then float lightly whipped cream on top. Don't stir after."),
  d("Hot Toddy", "mug", "build", "none", ["Lemon wheel"], [["Whiskey", 1.5], ["Honey syrup", 0.75], ["Lemon juice", 0.5], ["Hot water", 4]], "Whiskey, honey and lemon in hot water. The cold-night drink.", "Stir everything in a warm mug with hot (not boiling) water."),
  d("Irish Slammer", "pint", "build", "none", [], [["Stout", 8], ["Irish whiskey", 0.5], ["Irish cream", 0.5]], "Half a pint of stout with a shot of Irish whiskey and Irish cream dropped in. Drink it right away.", "Pour the stout. Layer the cream over the whiskey in a shot glass, drop it in and serve straight away."),
  // ---------- gin ----------
  d("Martini", "martini", "stir", "none", ["Lemon twist", "Olive"], [["Gin", 2.5], ["Dry vermouth", 0.5], ["Orange bitters", DASH, "opt"]], "Gin and dry vermouth, stirred ice cold. Ask: olive or twist?", "Stir with ice for 30 seconds and strain into a chilled martini glass."),
  d("Vesper", "martini", "shake", "none", ["Lemon peel"], [["Gin", 3], ["Vodka", 1], ["Lillet Blanc", 0.5]], "Gin, vodka and Lillet, shaken. Strong and crisp.", "Shake with ice and strain into a chilled glass."),
  d("Gin & Tonic", "highball", "build", "cubes", ["Lime wedge"], [["Gin", 2], ["Tonic water", 4]], "Gin and tonic over plenty of ice.", "Fill the glass with ice, add gin and top with tonic. Squeeze in the lime."),
  d("Gimlet", "coupe", "shake", "none", ["Lime wheel"], [["Gin", 2], ["Lime juice", 0.75], ["Simple syrup", 0.75]], "Gin, lime and sugar. Sharp and clean.", "Shake with ice and strain into a chilled coupe."),
  d("Tom Collins", "highball", "build", "cubes", ["Lemon wheel", "Cherry"], [["Gin", 2], ["Lemon juice", 1], ["Simple syrup", 0.75], ["Soda water", 2]], "Gin lemonade with bubbles. Tall and refreshing.", "Stir gin, lemon and syrup in the glass with ice and top with soda."),
  d("Gin Fizz", "highball", "shake", "none", ["Lemon wheel"], [["Gin", 2], ["Lemon juice", 0.75], ["Simple syrup", 0.75], ["Egg white", 1, "opt"], ["Soda water", 1]], "A gin sour lengthened with soda and served without ice. Foamy with egg white.", "Shake everything but the soda hard and strain into the glass. Top with soda."),
  d("Gin Rickey", "highball", "build", "cubes", ["Lime wedge"], [["Gin", 2], ["Lime juice", 0.5], ["Soda water", 4]], "Gin, lime and soda with no sugar. Very dry.", "Build over ice and stir once."),
  d("Bee's Knees", "coupe", "shake", "none", ["Lemon twist"], [["Gin", 2], ["Lemon juice", 0.75], ["Honey syrup", 0.75]], "A gin sour sweetened with honey.", "Shake with ice and strain into a chilled coupe."),
  d("Aviation", "coupe", "shake", "none", ["Cherry"], [["Gin", 2], ["Maraschino liqueur", 0.5], ["Crème de violette", 0.25], ["Lemon juice", 0.75]], "Gin with cherry liqueur and a touch of violet. Pale purple and floral.", "Shake with ice and strain into a chilled coupe."),
  d("Last Word", "coupe", "shake", "none", [], [["Gin", 0.75], ["Green Chartreuse", 0.75], ["Maraschino liqueur", 0.75], ["Lime juice", 0.75]], "Equal parts gin, Chartreuse, maraschino and lime. Herbal and tart.", "Shake with ice and strain into a chilled coupe."),
  d("Corpse Reviver No. 2", "coupe", "shake", "none", [], [["Gin", 0.75], ["Cointreau", 0.75], ["Lillet Blanc", 0.75], ["Lemon juice", 0.75], ["Absinthe", DASH, "opt"]], "Equal parts gin, orange liqueur, Lillet and lemon, with a whisper of absinthe.", "Rinse the glass with absinthe. Shake the rest with ice and strain in."),
  d("French 75", "wine", "shake", "none", ["Lemon twist"], [["Gin", 1], ["Lemon juice", 0.5], ["Simple syrup", 0.5], ["Prosecco", 3]], "Gin, lemon and sugar topped with sparkling wine.", "Shake gin, lemon and syrup with ice, strain into a flute and top with the bubbly."),
  d("Southside", "coupe", "shake", "none", ["Mint sprig"], [["Gin", 2], ["Lime juice", 0.75], ["Simple syrup", 0.75], ["Mint leaves", 6]], "A gin gimlet shaken with fresh mint.", "Shake everything hard with ice and fine-strain into a chilled coupe."),
  d("Clover Club", "coupe", "shake", "none", [], [["Gin", 1.5], ["Lemon juice", 0.5], ["Raspberry syrup", 0.5], ["Egg white", 1, "opt"]], "Gin, lemon and raspberry with a pink foam on top.", "Shake once without ice, then again with ice. Strain into a chilled coupe."),
  d("Bramble", "rocks", "shake", "crushed", ["Lemon wheel"], [["Gin", 2], ["Lemon juice", 1], ["Simple syrup", 0.5], ["Crème de cassis", 0.5]], "A gin sour over crushed ice with dark berry liqueur drizzled over the top.", "Shake gin, lemon and syrup and strain over crushed ice. Drizzle the cassis on top."),
  d("Negroni", "rocks", "stir", "cubes", ["Orange peel"], [["Gin", 1], ["Campari", 1], ["Sweet vermouth", 1]], "Equal parts gin, Campari and sweet vermouth. Bitter, sweet and strong.", "Stir with ice and strain over a big cube."),
  // ---------- vodka ----------
  d("Vodka Martini", "martini", "stir", "none", ["Lemon twist"], [["Vodka", 2.5], ["Dry vermouth", 0.5]], "Vodka and dry vermouth, stirred ice cold.", "Stir with ice and strain into a chilled martini glass."),
  d("Dirty Martini", "martini", "shake", "none", ["Olives"], [["Vodka", 2.5], ["Dry vermouth", 0.25], ["Olive brine", 0.5]], "A vodka martini made savory with olive brine.", "Shake with ice and strain into a chilled glass. Add the olives."),
  d("Vodka Soda", "highball", "build", "cubes", ["Lime wedge"], [["Vodka", 2], ["Soda water", 4]], "Vodka and soda water. Light and simple.", "Pour the vodka over ice and top with soda. Squeeze in the lime."),
  d("Vodka Tonic", "highball", "build", "cubes", ["Lime wedge"], [["Vodka", 2], ["Tonic water", 4]], "Vodka and tonic over ice.", "Pour the vodka over ice and top with tonic."),
  d("Vodka Cranberry", "highball", "build", "cubes", ["Lime wedge"], [["Vodka", 2], ["Cranberry juice", 4]], "Vodka and cranberry juice. Also called a Cape Codder.", "Build over ice and stir."),
  d("Vodka Lemonade", "highball", "build", "cubes", ["Lemon wheel"], [["Vodka", 2], ["Lemonade", 4]], "Vodka and lemonade over ice.", "Build over ice and stir."),
  d("Vodka Red Bull", "highball", "build", "cubes", [], [["Vodka", 1.5], ["Energy drink", 4]], "Vodka and an energy drink.", "Pour the vodka over ice and top with the energy drink."),
  d("Screwdriver", "highball", "build", "cubes", ["Orange slice"], [["Vodka", 2], ["Orange juice", 4]], "Vodka and orange juice.", "Build over ice and stir."),
  d("Greyhound", "highball", "build", "cubes", [], [["Vodka", 2], ["Grapefruit juice", 4]], "Vodka and grapefruit juice.", "Build over ice and stir."),
  d("Salty Dog", "highball", "build", "cubes", ["Salt rim"], [["Vodka", 2], ["Grapefruit juice", 4]], "A greyhound with a salted rim.", "Salt the rim, then build over ice."),
  d("Sea Breeze", "highball", "build", "cubes", ["Lime wedge"], [["Vodka", 1.5], ["Cranberry juice", 3], ["Grapefruit juice", 1.5]], "Vodka with cranberry and grapefruit.", "Build over ice and stir."),
  d("Bay Breeze", "highball", "build", "cubes", ["Lime wedge"], [["Vodka", 1.5], ["Cranberry juice", 3], ["Pineapple juice", 1.5]], "Vodka with cranberry and pineapple.", "Build over ice and stir."),
  d("Moscow Mule", "mug", "build", "cubes", ["Lime wheel", "Mint sprig"], [["Vodka", 2], ["Lime juice", 0.5], ["Ginger beer", 4]], "Vodka, lime and spicy ginger beer in a copper mug.", "Fill the mug with ice, add vodka and lime, and top with ginger beer."),
  d("Cosmopolitan", "martini", "shake", "none", ["Orange peel"], [["Vodka", 1.5], ["Cointreau", 0.75], ["Lime juice", 0.5], ["Cranberry juice", 1]], "Vodka, orange liqueur, lime and a splash of cranberry. Pink and tart.", "Shake with ice and strain into a chilled martini glass."),
  d("Lemon Drop", "martini", "shake", "none", ["Sugar rim", "Lemon twist"], [["Vodka", 2], ["Triple sec", 0.5], ["Lemon juice", 1], ["Simple syrup", 0.5]], "Sweet-tart lemon vodka in a sugared glass.", "Sugar the rim. Shake with ice and strain in."),
  d("White Russian", "rocks", "build", "cubes", [], [["Vodka", 2], ["Coffee liqueur", 1], ["Heavy cream", 1]], "Vodka and coffee liqueur with cream on top.", "Build vodka and coffee liqueur over ice and float the cream."),
  d("Black Russian", "rocks", "build", "cubes", [], [["Vodka", 2], ["Coffee liqueur", 1]], "Vodka and coffee liqueur over ice.", "Build over ice and stir."),
  d("Espresso Martini", "martini", "shake", "none", [], [["Vodka", 2], ["Coffee liqueur", 0.5], ["Espresso", 1], ["Simple syrup", 0.25, "opt"]], "Vodka, coffee liqueur and fresh espresso, shaken to a foam.", "Shake very hard with ice and strain into a chilled glass. Top with three coffee beans."),
  d("Mudslide", "rocks", "shake", "cubes", [], [["Vodka", 1], ["Coffee liqueur", 1], ["Irish cream", 1], ["Heavy cream", 1]], "Vodka, coffee liqueur and Irish cream. Dessert in a glass.", "Shake with ice and strain over fresh ice."),
  d("Chocolate Martini", "martini", "shake", "none", [], [["Vodka", 1.5], ["Crème de cacao", 1], ["Irish cream", 1]], "Vodka with chocolate liqueur and Irish cream.", "Shake with ice and strain into a chilled glass."),
  d("Appletini", "martini", "shake", "none", [], [["Vodka", 1.5], ["Sour apple schnapps", 1], ["Lemon juice", 0.5]], "Vodka with sour apple schnapps. Green and sweet-tart.", "Shake with ice and strain into a chilled glass."),
  d("French Martini", "martini", "shake", "none", [], [["Vodka", 1.5], ["Raspberry liqueur", 0.5], ["Pineapple juice", 1.5]], "Vodka, raspberry liqueur and pineapple, shaken frothy.", "Shake hard with ice and strain into a chilled glass."),
  d("Bloody Mary", "highball", "build", "cubes", ["Celery stalk", "Lime wedge"], [["Vodka", 2], ["Tomato juice", 4], ["Lemon juice", 0.5], ["Worcestershire sauce", 0.1], ["Hot sauce", 0.05, "opt"]], "Vodka in seasoned tomato juice. The brunch drink.", "Stir or roll everything between two glasses with ice and pour into an ice-filled glass."),
  d("Blue Lagoon", "highball", "build", "cubes", ["Lemon wheel"], [["Vodka", 1.5], ["Blue curaçao", 1], ["Lemonade", 4]], "Vodka and blue curaçao in lemonade. Bright blue.", "Build over ice and stir."),
  d("Sex on the Beach", "highball", "build", "cubes", ["Orange slice"], [["Vodka", 1.5], ["Peach schnapps", 0.75], ["Orange juice", 2], ["Cranberry juice", 2]], "Vodka and peach with orange and cranberry.", "Build over ice and stir."),
  d("Harvey Wallbanger", "highball", "build", "cubes", ["Orange slice", "Cherry"], [["Vodka", 1.5], ["Orange juice", 4], ["Galliano", 0.5]], "A screwdriver with a float of vanilla-herb Galliano.", "Build vodka and orange over ice and float the Galliano on top."),
  d("John Daly", "highball", "build", "cubes", ["Lemon wheel"], [["Vodka", 1.5], ["Lemonade", 3], ["Iced tea", 3]], "Half lemonade, half iced tea, with vodka.", "Build over ice and stir."),
  d("Transfusion", "highball", "build", "cubes", ["Lime wedge"], [["Vodka", 1.5], ["Grape juice", 3], ["Ginger ale", 2], ["Lime juice", 0.25, "opt"]], "Vodka, grape juice and ginger ale. A golf-course favorite.", "Build over ice and stir gently."),
  // ---------- rum ----------
  d("Daiquiri", "coupe", "shake", "none", ["Lime wheel"], [["White rum", 2], ["Lime juice", 1], ["Simple syrup", 0.75]], "Rum, lime and sugar, shaken and served up. Not the frozen kind.", "Shake hard with ice and strain into a chilled coupe."),
  d("Hemingway Daiquiri", "coupe", "shake", "none", ["Lime wheel"], [["White rum", 2], ["Grapefruit juice", 0.75], ["Maraschino liqueur", 0.5], ["Lime juice", 0.75]], "A dry daiquiri with grapefruit and maraschino.", "Shake with ice and strain into a chilled coupe."),
  d("Strawberry Daiquiri", "highball", "blend", "crushed", ["Lime wheel"], [["White rum", 2], ["Strawberry purée", 2], ["Lime juice", 1], ["Simple syrup", 0.5]], "Rum blended with strawberries and lime.", "Blend with a cup of ice until smooth."),
  d("Mojito", "highball", "build", "crushed", ["Mint sprig", "Lime wheel"], [["White rum", 2], ["Lime juice", 1], ["Simple syrup", 0.75], ["Mint leaves", 8], ["Soda water", 2]], "Rum, lime, sugar and fresh mint, topped with soda.", "Gently press the mint with lime and syrup. Add rum and crushed ice, stir, and top with soda."),
  d("Rum & Coke", "highball", "build", "cubes", ["Lime wedge"], [["White rum", 2], ["Cola", 4]], "Rum and cola over ice.", "Pour the rum over ice and top with cola."),
  d("Cuba Libre", "highball", "build", "cubes", ["Lime wedge"], [["White rum", 2], ["Lime juice", 0.5], ["Cola", 4]], "Rum and cola made brighter with fresh lime.", "Squeeze the lime into the glass, add ice and rum, and top with cola."),
  d("Dark 'n' Stormy", "highball", "build", "cubes", ["Lime wedge"], [["Dark rum", 2], ["Ginger beer", 4], ["Lime juice", 0.5, "opt"]], "Ginger beer with dark rum floated on top.", "Fill with ice and ginger beer, then float the dark rum."),
  d("Mai Tai", "rocks", "shake", "crushed", ["Mint sprig", "Lime wheel"], [["White rum", 1], ["Dark rum", 1], ["Triple sec", 0.5], ["Orgeat", 0.5], ["Lime juice", 1]], "Two rums with lime, orange and almond. The tiki classic, not the punch.", "Shake with ice and pour over crushed ice."),
  d("Piña Colada", "highball", "blend", "crushed", ["Pineapple wedge", "Cherry"], [["White rum", 2], ["Cream of coconut", 1.5], ["Pineapple juice", 3]], "Rum, coconut and pineapple, blended.", "Blend with a cup of ice until smooth."),
  d("Hurricane", "highball", "shake", "cubes", ["Orange slice", "Cherry"], [["White rum", 2], ["Dark rum", 2], ["Passion fruit syrup", 1], ["Orange juice", 1], ["Lime juice", 0.5], ["Grenadine", 0.25]], "A strong New Orleans rum punch with passion fruit.", "Shake with ice and strain into an ice-filled glass."),
  d("Painkiller", "highball", "shake", "cubes", ["Orange slice"], [["Dark rum", 2], ["Pineapple juice", 4], ["Orange juice", 1], ["Cream of coconut", 1]], "Dark rum with pineapple, orange and coconut. Nutmeg on top.", "Shake with ice, pour into the glass and grate nutmeg over it."),
  d("Rum Punch", "highball", "shake", "cubes", ["Orange slice", "Cherry"], [["Dark rum", 1], ["White rum", 1], ["Pineapple juice", 2], ["Orange juice", 2], ["Lime juice", 0.5], ["Grenadine", 0.25]], "Two rums with pineapple, orange and lime.", "Shake with ice and strain into an ice-filled glass."),
  d("Planter's Punch", "highball", "shake", "cubes", ["Orange slice", "Cherry"], [["Dark rum", 2], ["Lime juice", 1], ["Simple syrup", 0.75], ["Grenadine", 0.25], ["Angostura bitters", DASH * 2], ["Soda water", 1, "opt"]], "Dark rum, lime and sugar with a few dashes of bitters.", "Shake with ice, strain over fresh ice and top with a splash of soda."),
  d("Bahama Mama", "highball", "shake", "cubes", ["Cherry", "Orange slice"], [["Coconut rum", 1], ["Dark rum", 1], ["Pineapple juice", 2], ["Orange juice", 1], ["Grenadine", 0.25]], "Coconut and dark rum with pineapple and orange.", "Shake with ice and pour into the glass."),
  d("Blue Hawaiian", "highball", "shake", "cubes", ["Pineapple wedge", "Cherry"], [["White rum", 1], ["Blue curaçao", 0.75], ["Pineapple juice", 2], ["Cream of coconut", 0.75]], "Rum, blue curaçao, pineapple and coconut. Bright blue.", "Shake with ice and pour into the glass."),
  d("Malibu & Pineapple", "highball", "build", "cubes", ["Cherry"], [["Coconut rum", 2], ["Pineapple juice", 4]], "Coconut rum and pineapple juice.", "Build over ice and stir."),
  d("Caipirinha", "rocks", "build", "crushed", ["Lime wedge"], [["Cachaça", 2], ["Lime wedges", 4], ["Simple syrup", 0.75]], "Brazil's drink: cachaça with muddled lime and sugar.", "Muddle the lime wedges with syrup in the glass. Add cachaça and crushed ice and stir."),
  // ---------- tequila ----------
  d("Margarita", "margarita", "shake", "none", ["Salt rim", "Lime wheel"], [["Tequila", 2], ["Triple sec", 1], ["Lime juice", 1], ["Agave syrup", 0.25, "opt"]], "Tequila, orange liqueur and lime. Ask: salt or no salt?", "Salt half the rim. Shake with ice and strain into the glass."),
  d("Frozen Margarita", "margarita", "blend", "crushed", ["Salt rim", "Lime wheel"], [["Tequila", 2], ["Triple sec", 1], ["Lime juice", 1], ["Simple syrup", 0.5]], "A margarita blended with ice.", "Blend with a cup of ice until smooth. Pour into a salted glass."),
  d("Tommy's Margarita", "rocks", "shake", "cubes", ["Lime wheel"], [["Tequila", 2], ["Lime juice", 1], ["Agave syrup", 0.5]], "A margarita sweetened with agave instead of orange liqueur.", "Shake with ice and strain over fresh ice."),
  d("Spicy Margarita", "rocks", "shake", "cubes", ["Salt rim", "Jalapeño slice"], [["Tequila", 2], ["Triple sec", 0.75], ["Lime juice", 1], ["Agave syrup", 0.25], ["Jalapeño slices", 3]], "A margarita shaken with fresh jalapeño.", "Muddle the jalapeño in the shaker, add the rest and shake with ice. Strain over fresh ice."),
  d("Paloma", "highball", "build", "cubes", ["Salt rim", "Lime wedge"], [["Tequila", 2], ["Lime juice", 0.5], ["Grapefruit juice", 3], ["Soda water", 1]], "Tequila with grapefruit, lime and a splash of soda. Mexico's favorite.", "Salt the rim. Build over ice and top with soda."),
  d("Tequila Sunrise", "highball", "build", "cubes", ["Orange slice", "Cherry"], [["Tequila", 2], ["Orange juice", 4], ["Grenadine", 0.5]], "Tequila and orange juice with grenadine sinking to the bottom.", "Build tequila and orange over ice, then pour the grenadine down the side so it sinks."),
  d("Ranch Water", "highball", "build", "cubes", ["Lime wedge"], [["Tequila", 2], ["Lime juice", 0.75], ["Soda water", 4]], "Tequila, lime and sparkling water. West Texas simple.", "Build over ice."),
  d("El Diablo", "highball", "build", "cubes", ["Lime wheel"], [["Tequila", 1.5], ["Crème de cassis", 0.5], ["Lime juice", 0.5], ["Ginger beer", 3]], "Tequila and ginger beer with a swirl of black currant.", "Build tequila and lime over ice, top with ginger beer and drizzle the cassis."),
  d("Mexican Mule", "mug", "build", "cubes", ["Lime wheel"], [["Tequila", 2], ["Lime juice", 0.5], ["Ginger beer", 4]], "A Moscow Mule made with tequila.", "Fill the mug with ice, add tequila and lime, and top with ginger beer."),
  d("Carajillo", "rocks", "shake", "cubes", [], [["Licor 43", 1.5], ["Espresso", 1.5]], "Spanish vanilla liqueur shaken with hot espresso and poured over ice.", "Shake with ice until frothy and strain over fresh ice."),
  // ---------- brandy ----------
  d("Sidecar", "coupe", "shake", "none", ["Sugar rim", "Orange peel"], [["Brandy", 2], ["Cointreau", 0.75], ["Lemon juice", 0.75]], "Brandy, orange liqueur and lemon in a sugared coupe.", "Sugar half the rim. Shake with ice and strain in."),
  d("Brandy Alexander", "coupe", "shake", "none", [], [["Brandy", 1.5], ["Crème de cacao", 1], ["Heavy cream", 1]], "Brandy, chocolate liqueur and cream with nutmeg on top.", "Shake hard with ice, strain into a coupe and grate nutmeg over it."),
  d("Brandy Old Fashioned", "rocks", "build", "cubes", ["Orange slice", "Cherry"], [["Brandy", 2], ["Simple syrup", 0.25], ["Angostura bitters", DASH * 2], ["Lemon-lime soda", 2]], "The Wisconsin supper-club way: brandy and bitters topped with soda.", "Muddle the orange slice and cherry with syrup and bitters. Add ice and brandy and top with soda."),
  d("Pisco Sour", "coupe", "shake", "none", [], [["Pisco", 2], ["Lime juice", 1], ["Simple syrup", 0.75], ["Egg white", 1], ["Angostura bitters", DASH * 3, "opt"]], "Pisco, lime and sugar under a thick foam, dotted with bitters.", "Shake once without ice, then again with ice. Strain into a coupe and drop the bitters on the foam."),
  // ---------- liqueurs ----------
  d("Amaretto Sour", "rocks", "shake", "cubes", ["Cherry", "Orange slice"], [["Amaretto", 2], ["Lemon juice", 1], ["Simple syrup", 0.5], ["Egg white", 1, "opt"]], "Almond liqueur with lemon. Sweet and sour.", "Shake hard with ice and strain over fresh ice."),
  d("Fuzzy Navel", "highball", "build", "cubes", ["Orange slice"], [["Peach schnapps", 2], ["Orange juice", 4]], "Peach schnapps and orange juice.", "Build over ice and stir."),
  d("Alabama Slammer", "highball", "shake", "cubes", ["Orange slice"], [["Southern Comfort", 1], ["Sloe gin", 0.5], ["Amaretto", 0.5], ["Orange juice", 2]], "Southern Comfort, sloe gin and amaretto with orange.", "Shake with ice and strain over fresh ice."),
  d("Grasshopper", "coupe", "shake", "none", ["Mint sprig"], [["Crème de menthe", 1], ["Crème de cacao", 1], ["Heavy cream", 1]], "Mint and chocolate liqueurs shaken with cream. Pale green.", "Shake hard with ice and strain into a chilled coupe."),
  d("Aperol Spritz", "wine", "build", "cubes", ["Orange slice"], [["Prosecco", 3], ["Aperol", 2], ["Soda water", 1]], "Aperol and prosecco with a splash of soda. Bitter-orange and bubbly.", "Fill the glass with ice, add prosecco, then Aperol, then soda."),
  d("Americano", "highball", "build", "cubes", ["Orange slice"], [["Campari", 1], ["Sweet vermouth", 1], ["Soda water", 3]], "Campari and sweet vermouth lengthened with soda.", "Build over ice and top with soda."),
  // ---------- tall and long ----------
  d("Long Island Iced Tea", "highball", "shake", "cubes", ["Lemon wedge"], [["Vodka", 0.5], ["Gin", 0.5], ["White rum", 0.5], ["Tequila", 0.5], ["Triple sec", 0.5], ["Sour mix", 1], ["Cola", 1]], "Four white spirits and orange liqueur with sour mix and a splash of cola. No tea in it.", "Shake everything but the cola with ice, pour into the glass and top with cola."),
  // ---------- wine and beer ----------
  d("Mimosa", "wine", "build", "none", ["Orange twist"], [["Prosecco", 4], ["Orange juice", 2]], "Sparkling wine and orange juice.", "Pour the juice into a flute and top slowly with the bubbly."),
  d("Bellini", "wine", "build", "none", [], [["Prosecco", 4], ["Peach purée", 2]], "Prosecco with white peach purée.", "Pour the purée into a flute and top slowly with prosecco. Stir once."),
  d("Kir Royale", "wine", "build", "none", [], [["Prosecco", 5], ["Crème de cassis", 0.5]], "Sparkling wine with a little black currant liqueur.", "Pour the cassis into a flute and top with the bubbly."),
  d("Sangria", "wine", "build", "cubes", ["Orange slice"], [["Red wine", 4], ["Brandy", 0.5], ["Triple sec", 0.5], ["Orange juice", 1], ["Lemon-lime soda", 1, "opt"]], "Red wine with brandy, orange and fruit.", "Stir over ice and top with a splash of soda."),
  d("White Wine Spritzer", "wine", "build", "cubes", ["Lemon twist"], [["White wine", 4], ["Soda water", 2]], "White wine lightened with soda water.", "Build over ice."),
  d("Michelada", "pint", "build", "cubes", ["Salt rim", "Lime wedge"], [["Mexican lager", 12], ["Lime juice", 1], ["Tomato juice", 2, "opt"], ["Hot sauce", 0.1], ["Worcestershire sauce", 0.1]], "Mexican lager with lime, hot sauce and savory seasoning in a salted glass.", "Salt the rim. Add lime, sauces and tomato juice over ice, then top with the beer."),
  d("Red Beer", "pint", "build", "none", [], [["Light beer", 12], ["Tomato juice", 3]], "Light beer with a splash of tomato juice. A Midwest bar staple.", "Pour the tomato juice into the glass and top with cold beer."),
  d("Shandy", "pint", "build", "none", ["Lemon wheel"], [["Light beer", 8], ["Lemonade", 8]], "Half beer, half lemonade.", "Pour the beer, then top with lemonade."),
  // ---------- shots ----------
  d("Whiskey Shot", "shot", "build", "none", [], [["Whiskey", 1.5]], "A straight shot of whiskey.", "Pour 1.5 oz."),
  d("Tequila Shot", "shot", "build", "none", ["Salt", "Lime wedge"], [["Tequila", 1.5], ["Salt", 1, "opt"], ["Lime wedges", 1, "opt"]], "A shot of tequila with salt and lime on the side.", "Pour 1.5 oz. Serve with a lime wedge and salt."),
  d("Vodka Shot", "shot", "build", "none", [], [["Vodka", 1.5]], "A straight shot of vodka, chilled if you have it.", "Pour 1.5 oz."),
  d("Fireball Shot", "shot", "build", "none", [], [["Cinnamon whiskey", 1.5]], "A shot of cinnamon whiskey.", "Pour 1.5 oz."),
  d("Lemon Drop Shot", "shot", "shake", "none", ["Sugar rim", "Lemon wedge"], [["Vodka", 1], ["Lemon juice", 0.5], ["Simple syrup", 0.25]], "A lemon drop in a sugared shot glass.", "Sugar the rim. Shake with ice and strain in."),
  d("Kamikaze", "shot", "shake", "none", ["Lime wedge"], [["Vodka", 1], ["Triple sec", 0.5], ["Lime juice", 0.5]], "Vodka, orange liqueur and lime as a shot.", "Shake with ice and strain into the shot glass."),
  d("Green Tea Shot", "shot", "shake", "none", [], [["Whiskey", 0.5], ["Peach schnapps", 0.5], ["Sour mix", 0.5], ["Lemon-lime soda", 0.25]], "Whiskey, peach and sour with a splash of soda. Tastes nothing like whiskey.", "Shake the first three with ice, strain into the shot glass and top with soda."),
  d("Jägerbomb", "highball", "build", "none", [], [["Jägermeister", 1.5], ["Energy drink", 4]], "A shot of Jägermeister dropped into an energy drink.", "Pour the energy drink into a glass, drop in the shot and serve right away."),
  d("B-52", "shot", "build", "none", [], [["Coffee liqueur", 0.5], ["Irish cream", 0.5], ["Triple sec", 0.5]], "Coffee liqueur, Irish cream and orange liqueur in three layers.", "Pour each one slowly over the back of a spoon, in that order, so they layer."),
  d("Scotch & Soda", "highball", "build", "cubes", ["Lemon twist"], [["Scotch", 2], ["Soda water", 4]], "Scotch and soda water. Clean and classic.", "Pour the Scotch over ice and top with soda."),
];

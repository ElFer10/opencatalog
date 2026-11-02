# Guía de uso de OpenCatalog

OpenCatalog es un plugin para Adobe InDesign que conecta un documento con una fuente de datos (un CSV, un Excel, una base de datos Notion…). Colocas campos de los datos en la página y, cuando los datos cambian, el documento se actualiza con un clic.

Esta guía sigue el flujo de trabajo de principio a fin, usando como ejemplo un recetario y una carta de restaurante.

> **Nota:** la interfaz del plugin está en inglés. En esta guía los nombres de botones y menús aparecen tal como los verás, en **negrita**.

---

## Índice

1. [Instalación](#1-instalación)
2. [Preparar los datos](#2-preparar-los-datos)
3. [Abrir una fuente de datos](#3-abrir-una-fuente-de-datos)
4. [Explorar los datos en el panel](#4-explorar-los-datos-en-el-panel)
5. [Colocar campos en el documento](#5-colocar-campos-en-el-documento)
6. [Actualizar el documento y el panel](#6-actualizar-el-documento-y-el-panel)
7. [Formatos de campo](#7-formatos-de-campo)
8. [Campos calculados](#8-campos-calculados)
9. [Tablas](#9-tablas)
10. [Repetir un bloque de producto](#10-repetir-un-bloque-de-producto)
11. [Paginación automática](#11-paginación-automática)
12. [Exportar a PDF](#12-exportar-a-pdf)
13. [Versiones por idioma o mercado](#13-versiones-por-idioma-o-mercado)
14. [Un PDF por registro](#14-un-pdf-por-registro)
15. [Conectar fuentes remotas](#15-conectar-fuentes-remotas-url-notion-sql)
16. [Scripts](#16-scripts)
17. [Solución de problemas](#17-solución-de-problemas)
18. [Referencia rápida](#18-referencia-rápida)

---

## 1. Instalación

**Necesitas:** InDesign 2023 (versión 18.5) o posterior y **Adobe UXP Developer Tools**, que se instala desde la aplicación Creative Cloud.

1. Descomprime `opencatalog-plugin-x.y.z.zip`. Obtendrás una carpeta `opencatalog-plugin` con un archivo `manifest.json`.
2. Abre InDesign.
3. Abre **UXP Developer Tools**.
4. Pulsa **Add Plugin** y elige el `manifest.json` de la carpeta.
5. En la fila del plugin, pulsa **Load**.
6. En InDesign, abre el panel desde el menú **Plugins › OpenCatalog**. Puedes acoplarlo como cualquier otro panel.

La primera vez, InDesign puede pedir permiso para que el plugin acceda a archivos, a la red (para imágenes desde URL, Notion y APIs) o para ejecutar scripts. Acéptalo para usar esas funciones.

> **Para actualizar el plugin:** en UXP Developer Tools pulsa **Remove** en la versión anterior y repite los pasos 4 y 5 con la nueva carpeta.

---

## 2. Preparar los datos

OpenCatalog trabaja con **tablas**: una fila por registro (una receta, un producto) y una columna por campo (nombre, precio, imagen…).

**Reglas sencillas que evitan problemas:**

- **La primera fila contiene los nombres de los campos.**
- **Ten una columna que identifique cada fila de forma única** (un código, SKU, ID o un nombre que no se repita). Es la *clave*. El documento la usa para saber qué fila corresponde a cada campo colocado, así que no la cambies después de colocar campos.
- **Imágenes:** una columna con el nombre del archivo (`mousse.jpg`), una ruta completa (`/Users/fer/Fotos/mousse.jpg`) o una URL (`https://…/mousse.jpg`).
- **Varios idiomas:** usa sufijos como `Namn_sv` y `Namn_es` (ver [sección 13](#13-versiones-por-idioma-o-mercado)).

**Ejemplo (recetario):**

| Namn | Kategori | Portioner | Ingredienser | Bild |
| --- | --- | --- | --- | --- |
| Blåbärsmousse | Dessert | 10 | 500 g grädde<>200 g blåbär | mousse.jpg |
| Surdegsbröd | Tillbehör | 20 | 1 kg mjöl<>20 g salt | brod.jpg |

**Formatos de archivo admitidos:** CSV, TXT, TSV, Excel (`.xlsx`) y JSON. El antiguo `.xls` no está soportado: guárdalo como `.xlsx`.

> **Sobre la codificación:** si en Excel para Mac guardas como "CSV (Macintosh)", el archivo queda en Mac Roman. OpenCatalog lo detecta solo. Aun así, lo más seguro es guardar como **"CSV UTF-8"**.

---

## 3. Abrir una fuente de datos

1. En el panel, pulsa **Open data file…** (o **Open…** si ya hay un archivo abierto).
2. Elige el archivo.
3. Los registros aparecen en la lista. La barra inferior muestra cuántos registros y campos hay y cuál es la clave.

**Opciones de la barra superior:**

| Opción | Para qué sirve |
| --- | --- |
| **Reload** | Vuelve a leer el archivo después de editarlo. Marca los registros nuevos, cambiados y borrados (ver [6.4](#64-sincronizar-al-recargar)). |
| **Encoding** | Solo para CSV/TXT/JSON. Muestra la codificación detectada y te deja forzar otra si ves caracteres raros. |
| **Sheet** | Solo en Excel con varias hojas: elige la hoja. |
| **Key** | El campo clave. Se detecta automáticamente; cámbialo aquí si hace falta. |
| **Decimal** | Separador decimal con el que se escriben los números en el documento (`1.5` o `1,5`). |
| **Version** | Aparece si los datos tienen versiones por idioma (ver [sección 13](#13-versiones-por-idioma-o-mercado)). |

El panel recuerda el último archivo y la configuración de cada fuente (filtros, orden, formatos…).

---

## 4. Explorar los datos en el panel

### Buscar

Escribe en **Search all fields…**. Se muestran los registros que contienen todas las palabras, en cualquier campo.

### Filtrar

1. Pulsa **Filters**.
2. Pulsa **+ Add filter**.
3. Elige campo, condición (`contains`, `is`, `>`, `is empty`…) y valor. Pulsa Enter.
4. Con **Match** decides si se deben cumplir **all filters** (todos) o **any filter** (alguno).

### Ordenar

- **Clic** en el nombre de una columna: orden ascendente ▲, descendente ▼ y sin orden.
- **Mayúsculas + clic** en otra columna: añade un segundo criterio de orden.
- **Clear sort** quita el orden.

### Agrupar

En **Group by** elige un campo (por ejemplo `Kategori`). Para un segundo nivel, elige otro campo en **+ level**. Haz clic en una cabecera de grupo para plegarla o desplegarla; **Collapse all / Expand all** actúa sobre todas.

> Filtros, orden y grupos no son solo para mirar: **deciden qué entra y en qué orden** al paginar, crear tablas o exportar PDF por registro.

### Mostrar u ocultar campos

Pulsa **Fields** y marca o desmarca cada campo. Los campos ocultos no se colocan con **Place visible fields**, ni en tablas ni en la paginación por flujo.

### Seleccionar registros

- **Clic** en una fila: la selecciona (otro clic en la misma la deselecciona).
- **Cmd + clic** (Ctrl en Windows): añade o quita una fila.
- **Mayúsculas + clic**: selecciona un rango.

---

## 5. Colocar campos en el documento

1. Selecciona uno o varios registros en la lista.
2. En el desplegable junto a **Place field**, elige el campo.
3. Decide **dónde** irá el campo según lo que tengas seleccionado en InDesign:

| Selección en InDesign | Resultado |
| --- | --- |
| **Cursor de texto** dentro de un texto | El valor se inserta en el cursor. Puedes mezclar texto fijo y campos: `Porciones: ` + campo `Portioner`. |
| **Un marco de texto** (herramienta de selección) | Todo el marco muestra ese campo. |
| **Nada** | Se crea un marco nuevo en la página activa. |

4. Pulsa **Place field**.

**Otras formas de colocar:**

- **Place visible fields:** inserta todos los campos visibles de los registros seleccionados, un párrafo por campo.
- **Campos de imagen:** elige un campo de tipo imagen (aparece como `Bild (image)`), selecciona un marco gráfico vacío o nada, y pulsa **Place image**. La imagen se encaja proporcionalmente y se centra.

**Dónde busca las imágenes:**

- Rutas completas y URLs se usan tal cual (las URLs se descargan a una caché).
- Los nombres sueltos (`mousse.jpg`) se buscan en la carpeta elegida en **Images › Choose…** o, si no eliges ninguna, en la carpeta del archivo de datos.

> **Cómo reconocer un campo colocado:** los campos dentro de texto quedan marcados con la etiqueta XML `oc_field` (visible en **Ventana › Utilidades › Estructura**). Los marcos enteros llevan una etiqueta de script. No borres ni renombres esas marcas.

---

## 6. Actualizar el documento y el panel

### 6.1 Update document (datos → documento)

Cuando cambien los datos:

1. Edita y guarda el archivo (por ejemplo, cambia un precio en Excel).
2. Pulsa **Reload** en el panel.
3. Pulsa **Update document**.

Todos los campos colocados se actualizan. Si algo no te gusta, **Edición › Deshacer** revierte toda la actualización en un solo paso.

**Update selected** actualiza solo los campos de los registros seleccionados.

### 6.2 Update panel (documento → datos)

Si corriges un texto directamente en InDesign:

1. Edita el texto del campo en el documento.
2. Pulsa **Update panel**.
3. Los valores cambiados quedan resaltados en amarillo en la lista.
4. Pulsa **Save as CSV…** para guardar los datos corregidos en un archivo.

Los campos calculados no se pueden editar así (se avisa en el informe).

### 6.3 Informe de errores

Después de actualizar aparece un resumen, por ejemplo *"Update document: 12 fields updated, 40 unchanged, 1 error"*. Debajo se listan los problemas: registros que ya no existen, campos borrados, imágenes que no se encuentran… **Haz clic en una línea para ir a ese elemento en el documento.**

### 6.4 Sincronizar al recargar

Al pulsar **Reload**, OpenCatalog compara los datos nuevos con los anteriores:

- La barra inferior resume los cambios: *"2 new, 3 changed, 1 deleted"*.
- Las celdas cambiadas se resaltan en azul y los registros nuevos en verde.
- **Show › new / changed** filtra la lista para ver solo esos registros.
- Si un registro borrado sigue colocado en el documento, aparece en el informe.

### 6.5 Recuento de colocaciones

Pulsa **Count**: la columna `#` muestra cuántas veces está colocado cada registro. Con **Show › placed / not placed** ves qué registros faltan por colocar.

---

## 7. Formatos de campo

Los formatos cambian **cómo se escribe** un valor en el documento, sin tocar los datos.

1. Pulsa **Fields**.
2. Pulsa **Format…** junto al campo.
3. Ajusta las opciones; el cambio se ve al momento en la lista.
4. Pulsa **Update document** para aplicarlo a lo ya colocado.

| Opción | Ejemplo |
| --- | --- |
| **Prefix / Suffix** | Sufijo ` kr` → `95 kr` |
| **If empty** | `—` cuando no hay valor |
| **Case** | UPPER, lower, Title Case |
| **Decimals** (números) | 2 → `95,00` |
| **Thousands** (números) | espacio → `1 299,50` |
| **Date** + **Locale** (fechas) | `D MMMM YYYY` con `sv-SE` → `1 mars 2026` |

**Códigos de fecha:** `YYYY` año, `YY` año corto, `MMMM` mes completo, `MMM` mes abreviado, `MM`/`M` número de mes, `DD`/`D` día, `HH` hora, `mm` minutos.

**Reset** quita el formato.

---

## 8. Campos calculados

Un campo calculado se obtiene de otros campos mediante una fórmula. Se coloca y se actualiza como cualquier otro campo.

1. Pulsa **Fields** y baja hasta **Computed fields**.
2. Escribe un **Name** y la fórmula.
3. Pulsa **+ Add**.

**Ejemplos útiles:**

```
replace({Ingredienser}, "<>", "\n")          → cada ingrediente en su propia línea
upper({Namn})                                → BLÅBÄRSMOUSSE
{Namn} & " – " & {Portioner} & " port."     → Blåbärsmousse – 10 port.
{Pris} * 1.12                                → precio con IVA del 12 %
round({Pris} * 0.9, 0)                       → 10 % de descuento, redondeado
if({Gluten} = "Ja", "Contiene gluten", "")   → aviso de alérgeno
join(", ", {Gluten}, {Mjölk}, {Nötter})      → une valores no vacíos con comas
```

**Sintaxis:**

- Los campos van entre llaves: `{Namn}`. Los nombres sin espacios también funcionan sin llaves.
- El texto va entre comillas: `"kr"`. `"\n"` es un salto de línea.
- Operadores: `+ - * / %`; `&` une textos; `= <> < <= > >=`; `and`, `or`, `not`.
- Funciones: `abs`, `ceil`, `coalesce`, `concat`, `contains`, `floor`, `if`, `isempty`, `join`, `left`, `len`, `lower`, `max`, `mid`, `min`, `number`, `replace`, `right`, `round`, `startswith`, `text`, `trim`, `upper`.

Si una fórmula tiene errores, aparece un aviso ⚠ junto al campo con la explicación.

---

## 9. Tablas

Crea una tabla de InDesign con una fila por registro y una columna por campo visible.

1. Muestra solo los campos que quieras como columnas (**Fields**).
2. Selecciona los registros (por ejemplo, todos los de una categoría).
3. En InDesign, selecciona un marco de texto vacío, pon el cursor en un texto o no selecciones nada.
4. Marca **header** si quieres una fila de títulos.
5. Pulsa **Place as table**.

Cada celda queda vinculada: **Update document** la mantiene al día. Puedes dar a la tabla el estilo que quieras en InDesign.

---

## 10. Repetir un bloque de producto

Ideal para fichas en cuadrícula: diseñas **un** bloque y se copia para muchos registros en la misma página.

1. Diseña el bloque de un registro: coloca sus campos (nombre, foto, precio…) y dales estilo.
2. Selecciona todos los marcos del bloque con la herramienta de selección (o agrúpalos).
3. En la lista, selecciona los registros que quieres maquetar.
4. Ajusta **gap** (separación entre bloques, en las unidades del documento).
5. Pulsa **Repeat layout**.

Las copias se colocan en cuadrícula dentro de los márgenes y cada una se rellena con su registro. Si no caben todas, se indica cuáles faltan. Para repartirlas en varias páginas, usa la paginación.

---

## 11. Paginación automática

Pulsa **Paginate…** para abrir las opciones. En **Records** elige **all in view** (lo que muestra la lista, con sus filtros, orden y grupos) o **selected** (solo lo seleccionado).

### 11.1 Modo plantilla (fichas en cuadrícula)

1. Diseña el bloque de un registro, como en la [sección 10](#10-repetir-un-bloque-de-producto), dentro de los márgenes de la página.
2. Selecciónalo con la herramienta de selección.
3. En **Mode** elige **Template: repeat the selected block**.
4. Opcional: agrupa la lista (por ejemplo por `Kategori`) y marca **new page for each Kategori** para que cada categoría empiece en página nueva.
5. Pulsa **Paginate**.

El bloque pasa a mostrar el primer registro y se copia por todas las páginas necesarias. Las páginas nuevas usan la misma página maestra que la de la plantilla.

### 11.2 Modo flujo de texto (listas, cartas, índices)

Cada registro se convierte en un párrafo dentro de un texto encadenado que crece por las páginas.

1. **Recomendado:** crea en el documento estilos de párrafo con estos nombres exactos y diséñalos a tu gusto (tabuladores, tamaños, espacios). Se aplican automáticamente:
   - `OC Heading 1`: encabezado del primer nivel de grupo (por ejemplo, la categoría).
   - `OC Heading 2`: encabezado del segundo nivel.
   - `OC Record`: cada registro.
2. Agrupa la lista si quieres encabezados (por ejemplo `Kategori`).
3. Deja visibles solo los campos que deben aparecer en cada línea.
4. En **Mode** elige **Text flow: one paragraph per record**.
5. En **Fields separated by** elige **tab** (todo en una línea, ideal para una carta con precios alineados) o **paragraph** (cada campo en su línea).
6. Selecciona un marco de texto vacío, pon el cursor en un texto o no selecciones nada (se crea un marco que ocupa los márgenes).
7. Pulsa **Paginate**.

Se añaden páginas y marcos encadenados hasta que todo el texto cabe.

> **Ejemplo de carta:** estilo `OC Record` con un tabulador derecho con puntos al final de la línea, campos visibles `Namn` y `Pris`, separador **tab** y lista agrupada por `Kategori`. Obtienes la carta con categorías y precios alineados.

**Límites actuales:**

- En documentos con páginas enfrentadas, las copias usan los márgenes de la página de la plantilla, sin invertir interior y exterior.
- El modo flujo no admite imágenes dentro del texto.

---

## 12. Exportar a PDF

1. En **Paginate…**, elige el **PDF preset** (los ajustes preestablecidos de InDesign, como *[Calidad de impresión alta]*).
2. Pulsa **Export PDF…** y elige dónde guardarlo.

---

## 13. Versiones por idioma o mercado

Si tus datos tienen columnas como `Namn_sv` / `Namn_es` o `Pris (SE)` / `Pris (ES)`, OpenCatalog las reconoce como **versiones** del mismo campo. Un sufijo cuenta como versión cuando lo usan al menos dos campos.

1. Si no existe una columna `Namn`, se crea automáticamente para poder colocarla.
2. Coloca los campos **sin sufijo** (`Namn`, `Beskrivning`, `Pris`).
3. En la barra superior, en **Version**, elige el idioma (`sv`, `es`…).
4. Pulsa **Update document**: el documento entero cambia a ese idioma.

**Para exportar todos los idiomas de una vez:** en **Paginate…** pulsa **PDF for each version** y elige una carpeta. Se crea un PDF por versión (`carta-sv.pdf`, `carta-es.pdf`) y al terminar el documento vuelve a la versión que tenías.

Si una versión está vacía para un registro, se usa el valor del campo base cuando existe.

---

## 14. Un PDF por registro

Para fichas de receta, etiquetas de precio, fichas técnicas…: un documento que muestra **un** registro y se exporta una vez por cada registro.

1. Diseña el documento con los campos de **un solo** registro (por ejemplo, una receta).
2. En la lista, filtra o selecciona los registros que quieres exportar.
3. En **Paginate…**, elige **Records** (**all in view** o **selected**).
4. En **named by** elige el campo que dará nombre a los archivos (por ejemplo `Namn`).
5. Pulsa **One PDF per record** y elige una carpeta.

Se genera `Blåbärsmousse.pdf`, `Surdegsbröd.pdf`, etc. Al terminar, el documento vuelve a mostrar el registro original.

> El documento debe mostrar campos de **un solo** registro; si hay varios, el plugin te avisa.

---

## 15. Conectar fuentes remotas (URL, Notion, SQL)

Pulsa **Connect…**, elige el **Type**, dale un **Name** a la conexión y pulsa **Connect and save**. Las conexiones guardadas aparecen en **Saved**. Los tokens se guardan en el almacenamiento seguro de UXP, no en los ajustes. **Reload** vuelve a descargar los datos.

### 15.1 URL (JSON o CSV)

Para APIs REST, exportaciones de un PIM, una hoja publicada como CSV, etc.

- **URL:** la dirección de los datos. Elige **JSON** o **CSV**.
- **Records at:** ruta a la lista de registros dentro del JSON (por ejemplo `data.items`). Vacío = se detecta sola.
- **Next page at:** si la API reparte los datos en páginas, la ruta al enlace de la página siguiente (por ejemplo `links.next`).
- **Header / Token:** autenticación, por ejemplo `Authorization` con el valor `Bearer {token}`. `{token}` se sustituye por el token que escribas.

### 15.2 Base de datos de Notion

1. Entra en [notion.so/my-integrations](https://www.notion.so/my-integrations) y crea una integración interna. Copia su token.
2. En Notion, abre tu base de datos (por ejemplo, el recetario), menú **•••** › **Conexiones** y añade la integración.
3. En el panel: **Type › Notion database**, pega el enlace de la base de datos y el token.

Títulos, textos, números, selecciones, fechas, archivos (como URL), fórmulas y rollups se convierten en campos. El título queda como primer campo.

### 15.3 Base de datos SQL (SQLite u ODBC)

Los plugins de InDesign no pueden conectarse directamente a bases de datos, así que se usa un pequeño programa auxiliar en tu ordenador.

1. Abre la aplicación Terminal y ejecuta:
   ```bash
   python3 opencatalog-helper.py
   ```
   Se muestra un **token**. Deja la ventana abierta mientras trabajas.
2. En el panel: **Type › SQL database**.
   - **Helper:** `http://127.0.0.1:8765`
   - **Token:** el que mostró el helper.
   - **Connection:** `sqlite:/ruta/a/tu/base.db`, u `odbc:DSN=…;UID=…;PWD=…` para otras bases (SQL Server, MySQL, PostgreSQL, FileMaker…). ODBC requiere `pip install pyodbc` y el driver correspondiente.
   - **Query:** por ejemplo `SELECT * FROM recetas WHERE activa = 1`.

Por seguridad, el helper solo acepta conexiones desde tu propio ordenador, exige el token y solo permite consultas de lectura (`SELECT`/`WITH`).

---

## 16. Scripts

Para automatizar tareas repetitivas. Pulsa **Script…**, escribe JavaScript y pulsa **Run**. Los scripts se pueden guardar con un nombre (**Save**).

**Lo que puedes usar dentro de un script:**

| Expresión | Qué hace |
| --- | --- |
| `oc.records()` | Registros en el orden de la lista (con filtros y orden) |
| `oc.all()` | Todos los registros |
| `oc.fields` | Nombres de los campos |
| `oc.selected()` / `oc.select(ids)` | Leer o cambiar la selección |
| `oc.versions` / `oc.setVersion("es")` | Versiones disponibles / cambiar de versión |
| `await oc.updateDocument()` | Update document (opcionalmente solo unos ids) |
| `await oc.placeFields(["Namn"])` | Colocar campos de la selección |
| `await oc.paginate()` | Paginar con las opciones actuales |
| `oc.exportPdf(ruta, preset)` | Exportar PDF |
| `oc.indesign` | Acceso directo a InDesign (`app`, documentos, páginas…) |
| `oc.log(...)` | Escribir en la salida |

**Ejemplo:** seleccionar los postres de menos de 90 kr.

```js
const baratos = oc.records().filter(r => r.values.Kategori === "Dessert" && r.values.Pris < 90);
oc.select(baratos.map(r => r.id));
oc.log(baratos.length, "postres seleccionados");
```

**Ejemplo:** exportar la carta en todos los idiomas a una carpeta fija.

```js
for (const v of oc.versions) {
  oc.setVersion(v);
  await oc.updateDocument();
  oc.exportPdf(`/Users/fer/Desktop/carta-${v}.pdf`);
}
```

---

## 17. Solución de problemas

| Problema | Solución |
| --- | --- |
| Caracteres raros (`Gšr sŒ hŠr` en vez de `Gör så här`) | Cambia **Encoding** a *Mac Roman* o *Windows (1252)*, o guarda el archivo como "CSV UTF-8". |
| *"Record … no longer exists"* | La clave de ese registro cambió o se borró en los datos. Restáurala, o borra el campo colocado. |
| Una imagen no aparece | Comprueba la carpeta en **Images › Choose…** y que el nombre del archivo coincida, incluidas mayúsculas y extensión. |
| Los números salen con punto en vez de coma | Cambia **Decimal** a `1,5`, o usa un formato con decimales. |
| *"The selection mixes fields of N records"* | Para repetir o paginar, la selección debe mostrar campos de **un solo** registro. |
| *"The template must sit inside the page margins"* | Mueve el bloque plantilla dentro de los márgenes de la página. |
| No se conecta a Notion | Comprueba el token y que la base de datos esté compartida con la integración (**••• › Conexiones**). |
| *"Cannot reach the helper"* | El helper no está en marcha: ejecuta `python3 opencatalog-helper.py` y usa el token que muestra. |
| El panel se ve mal o los botones se solapan | Actualiza a la última versión del plugin y amplía el panel. Si persiste, envía una captura. |
| Cualquier otro error | En UXP Developer Tools, en la fila del plugin, abre **Debug** y copia el error de la consola. |

**Recuerda:** casi todas las operaciones en el documento se deshacen en un solo paso con **Edición › Deshacer**.

---

## 18. Referencia rápida

| Quiero… | Hago… |
| --- | --- |
| Abrir datos | **Open…** o **Connect…** |
| Ver solo algunos registros | Buscar, **Filters**, **Group by** |
| Poner un campo en la página | Seleccionar registro → elegir campo → **Place field** |
| Poner una imagen | Campo de imagen → **Place image** |
| Aplicar cambios de los datos | **Reload** → **Update document** |
| Guardar correcciones hechas en InDesign | **Update panel** → **Save as CSV…** |
| Dar formato a precios o fechas | **Fields** → **Format…** |
| Combinar campos | **Fields** → **Computed fields** |
| Crear una tabla | Seleccionar registros → **Place as table** |
| Fichas en cuadrícula en una página | Seleccionar bloque → **Repeat layout** |
| Catálogo de muchas páginas | **Paginate…** → modo plantilla o flujo → **Paginate** |
| PDF del documento | **Export PDF…** |
| Carta en varios idiomas | **Version** / **PDF for each version** |
| Un PDF por receta o producto | **Paginate…** → **One PDF per record** |
| Automatizar | **Script…** |

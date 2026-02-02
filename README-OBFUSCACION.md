# Guía de Ofuscación

## Instalación

1. Instala las dependencias:
```bash
npm install
```

## Uso

2. Ejecuta el script de ofuscación:
```bash
npm run obfuscate
```

O directamente:
```bash
node obfuscate.js
```

## Resultado

Los archivos ofuscados se guardarán en la carpeta `obfuscated/`:
- `obfuscated/background.js`
- `obfuscated/contentScript.js`
- `obfuscated/popup.js`
- `obfuscated/mapping.js`

## Pruebas

1. **Copia los archivos ofuscados** a la raíz del proyecto (o actualiza `manifest.json` para apuntar a `obfuscated/`)
2. **Carga la extensión** en Chrome (chrome://extensions)
3. **Prueba todas las funcionalidades**:
   - Captura de reservas
   - Mapeo manual
   - Mapeo con IA
   - Rellenado de formularios

## Si algo falla

1. Ajusta las opciones en `obfuscate.js`:
   - Reduce `controlFlowFlatteningThreshold`
   - Desactiva `deadCodeInjection`
   - Cambia `disableConsoleOutput` a `false`

2. Prueba archivo por archivo para identificar cuál causa problemas

## Notas

- Los archivos originales NO se modifican
- Siempre mantén una copia de seguridad
- La ofuscación aumenta el tamaño de los archivos (~2-3x)


# Comandos de Execucao

## Instalacao
```powershell
npm install
```

## Execucao oculta (headless)
Roda sem abrir navegador:

```powershell
node app.js --once
```

Modo continuo (a cada 60s):

```powershell
node app.js --watch=60
```

## Execucao visual (headful)
Abre o Chromium para acompanhar o fluxo:

```powershell
node app.js --once --headful
```

Modo continuo com navegador visivel:

```powershell
node app.js --watch=60 --headful
```

## Baixar laudos especificos
Para baixar somente alguns pedidos:

```powershell
node app.js --once --pedidos=7386101-01,7386642-01
```

Tambem funciona com modo visual:

```powershell
node app.js --once --headful --pedidos=7386101-01,7386642-01
```

## Forcar re-download
Ignora arquivos ja existentes:

```powershell
node app.js --once --force
```

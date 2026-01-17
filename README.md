# Objetivo da plataforma
'''Importante destacar o objetivo dessa ferramenta. Como estou na UTI com minha esposa e é muito cansativo ficar fazendo login diversas vezes, conexão caindo, Internet ruim, decidi criar essa aplicação que tem a função de um robô que vai substituir a operação humana.
Ele varre e baixa todos os exames que ainda não foram baixados.
Obs.: esse software não tem a intenção de acessar nenhuma informação que não seja do usuário autenticado, ou seja, do paciente que possui o seu cadastro autenticado. Essa ferramenta não acessa nada que não seja com a própria ação do paciente. 


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

FROM php:8.2-cli

# 1. Installiamo le estensioni per il database
RUN docker-php-ext-install pdo pdo_mysql

# 2. Creiamo la cartella di lavoro
WORKDIR /app

# 3. Copiamo i tuoi file (app_api.php, functions.php, ecc.)
COPY . .

# 4. Esponiamo la porta che Railway si aspetta (di default 80 o quella variabile $PORT)
EXPOSE 80

# 5. Avviamo il server interno di PHP sulla porta 80
# Questo comando dice a PHP di fare da server per tutti i file nella cartella
CMD ["php", "-S", "0.0.0.0:80"]

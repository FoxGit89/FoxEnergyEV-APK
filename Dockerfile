FROM php:8.2-cli

# 1. Installiamo le estensioni per il database
RUN docker-php-ext-install pdo pdo_mysql

# 2. Creiamo la cartella di lavoro
WORKDIR /app

# 3. Copiamo i tuoi file
COPY . .

# 4. Avviamo il server sulla porta assegnata da Railway ($PORT)
# Se $PORT non esiste, usa la 8080 come backup
CMD php -S 0.0.0.0:${PORT:-8080}

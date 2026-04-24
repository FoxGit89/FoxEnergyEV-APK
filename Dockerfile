FROM php:8.2-cli
 
# Estensioni DB
RUN docker-php-ext-install pdo pdo_mysql
 
WORKDIR /app
 
COPY . .
 
# Avvia il server PHP dalla root /app
# Il router.php gestisce i redirect dalla root a /public/
CMD php -S 0.0.0.0:${PORT:-8080} router.php
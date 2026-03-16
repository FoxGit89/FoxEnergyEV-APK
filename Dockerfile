FROM php:8.2-apache

# Installa le estensioni per il database MySQL
RUN docker-php-ext-install pdo pdo_mysql

# Abilita il modulo rewrite di Apache
RUN a2enmod rewrite

# Copia i tuoi file dentro il server
COPY . /var/www/html/

# Permessi corretti
RUN chown -R www-data:www-data /var/www/html

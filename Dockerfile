FROM php:8.2-apache

# 1. Installiamo le estensioni necessarie
RUN docker-php-ext-install pdo pdo_mysql

# 2. RISOLUZIONE ERRORE MPM: 
# Disabilitiamo il modulo 'event' e forziamo 'prefork' che è l'unico compatibile con PHP
RUN a2dismod mpm_event && a2enmod mpm_prefork

# 3. Abilitiamo il modulo rewrite (utile per le API)
RUN a2enmod rewrite

# 4. Copiamo i file nella cartella di Apache
COPY . /var/www/html/

# 5. Diamo i permessi corretti a tutto
RUN chown -R www-data:www-data /var/www/html

# 6. Espone la porta 80 (default di Apache)
EXPOSE 80

# Comando di avvio standard
CMD ["apache2-foreground"]

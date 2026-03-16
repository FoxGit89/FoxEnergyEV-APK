FROM php:8.2-apache

# 1. Installiamo le estensioni per MySQL
RUN docker-php-ext-install pdo pdo_mysql

# 2. RISOLUZIONE DEFINITIVA MPM: 
# Eliminiamo fisicamente ogni traccia di mpm_event e mpm_worker 
# e forziamo l'abilitazione di mpm_prefork (obbligatorio per PHP)
RUN rm -f /etc/apache2/mods-enabled/mpm_event.load /etc/apache2/mods-enabled/mpm_event.conf \
    && rm -f /etc/apache2/mods-enabled/mpm_worker.load /etc/apache2/mods-enabled/mpm_worker.conf \
    && a2enmod mpm_prefork

# 3. Abilitiamo il modulo rewrite
RUN a2enmod rewrite

# 4. Copiamo i file
COPY . /var/www/html/

# 5. Permessi e Porta
RUN chown -R www-data:www-data /var/www/html
EXPOSE 80

CMD ["apache2-foreground"]

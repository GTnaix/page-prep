<?php
  session_start();
  require_once __DIR__ . '/../include/working-pro/vendor/autoload.php';

  require_once __DIR__ . '/../include/lib/funnel_landing.php';

  $funnel = funnel_get_product_for_landing_from_config(__DIR__ . '/../include/config', 'CA', 'en');

  $pixel_fb = $_GET['pixel_fb'] ?? '';
  $product_name     = $funnel['product_name'];
  $advertiser_name = $funnel['advertising_name'];
?>

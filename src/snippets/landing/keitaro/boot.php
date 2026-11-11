<?php
  session_start();
  require_once __DIR__ . '/../../settings/vendor/autoload.php';
  require_once __DIR__ . '/../../working-pro/vendor/autoload.php';

  $country = 'CA';
  $lang = 'en';

  if (!isset($rawClick) && !isset($click)) {
    return;
  }

  $rawClick = $rawClick ?? $click;

  $get_product = $_GET['product'] ?? null;
  $get_advertiser = $_GET['advertiser'] ?? null;

  try {
    $app = new \Core\App(
      __DIR__ . '/../../application/config/config.ini.php',
      $rawClick
    );

    $data = $app->getData(null, $country . '-' . $lang);

    if (!$data) {
      $data = $app->getData($country);
    }

    $product_name = $data['product_name'] ?? '';
    $advertiser_name = $data['advertising_name'] ?? '';

    if (!empty($get_product)) {
      $product_name = $get_product;
    }

    if (!empty($get_advertiser)) {
      $advertiser_name = $get_advertiser;
    }
  } catch (Exception $e) {
    error_log($e->getMessage());
  }
?>

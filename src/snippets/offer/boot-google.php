<?php
  session_start();
  require_once __DIR__ . '/../../landers/include/working-pro/vendor/autoload.php';
  require_once __DIR__ . '/../../landers/include/lib/funnel_landing.php';

  // Значения из GET (пустая строка = нет значения)
  $product_name = trim((string)($_GET['product'] ?? ''));
  $advertiser_name = trim((string)($_GET['advertiser'] ?? ''));

  // Если нет хотя бы одного параметра, оба значения берём из БД
  if ($product_name === '' || $advertiser_name === '') {
    $funnel = funnel_get_product_for_landing_from_config(
      __DIR__ . '/../../landers/include/config',
      'CA',
      'en'
    );

    $product_name = $funnel['product_name'] ?? '';
    $advertiser_name = $funnel['advertising_name'] ?? '';
  }

  $offer_id = $_GET['offer_id'] ?? '{offer_id}';
  $campaign_id = $_GET['campaign_id'] ?? '{campaign_id}';
  $subid = $_GET['clickid'] ?? '{clickid}';
  $ip = $_GET['ip'] ?? '{ip}';
  $refer = $_GET['referer'] ?? '{referer}';
  $pixel_fb = $_GET['pixel_fb'] ?? '{t7}';
  $creative = $_GET['c'] ?? '{c}';
  $gtmCodeSafe = $_GET['gtag'] ?? '';

  $land = 'http://' . $_SERVER['HTTP_HOST'] . strtok($_SERVER['REQUEST_URI'], '?');
?>

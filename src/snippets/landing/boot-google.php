<?php
  session_start();
  require_once __DIR__ . '/../include/working-pro/vendor/autoload.php';

  require_once __DIR__ . '/../include/lib/funnel_landing.php';

  $funnel = funnel_get_product_for_landing_from_config(__DIR__ . '/../include/config', 'CA', 'en');

  $pixel_fb = $_GET['pixel_fb'] ?? '';
  $product_name     = $funnel['product_name'];
  $advertiser_name = $funnel['advertising_name'];
  $campaignName = $_POST['{campaign_name}'] ?? '';
  $clickId      = $_POST['{clickid}'] ?? '';

  $gtmCode = 'GTM-5HFF764B';
  if (preg_match('/GTM-(\S+)/', $campaignName, $matches)) {
    $gtmCode = 'GTM-' . $matches[1];
  }

  $gtmCodeSafe = htmlspecialchars($gtmCode, ENT_QUOTES);

  // Записываем gtag в клик Binom
  if ($clickId !== '' && $gtmCode !== '') {
    $updateUrl = 'https://indigobase.pro/click?' . http_build_query([
      'upd_clickid' => $clickId,
      'gtag'        => $gtmCode,
    ], '', '&', PHP_QUERY_RFC3986);

    $ch = curl_init($updateUrl);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT        => 3,
      CURLOPT_CONNECTTIMEOUT => 2,
      CURLOPT_FOLLOWLOCATION => false,
      CURLOPT_NOSIGNAL       => 1,
    ]);
    curl_exec($ch);
    curl_close($ch);
  }
?>

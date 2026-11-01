Pod::Spec.new do |s|
  s.name           = 'LiveActivity'
  s.version        = '0.1.0'
  s.summary        = 'Starts and ends Nightshift Signals Live Activities and reports their APNs push tokens.'
  s.author         = 'Nightshift Signals'
  s.homepage       = 'https://nightshift-signals.invalid'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version  = '5.9'
  s.source_files   = '**/*.swift'
end

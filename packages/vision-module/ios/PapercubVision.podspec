require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'PapercubVision'
  s.version        = package['version']
  s.summary        = 'On-device drawing isolation for Papercub. Nothing leaves the device.'
  s.description    = 'Subject lifting, paper normalisation, ink extraction, palette and privacy scanning. No network access of any kind.'
  s.license        = 'UNLICENSED'
  s.author         = 'Papercub'
  s.homepage       = 'https://papercub.app'
  s.platforms      = { :ios => '16.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Subject lifting (Vision), perspective + adaptive threshold (CoreImage),
  # capture guidance (AVFoundation), metadata-free file writes (ImageIO).
  s.frameworks = 'Vision', 'CoreImage', 'CoreGraphics', 'ImageIO', 'AVFoundation', 'CoreMedia', 'CoreVideo', 'UniformTypeIdentifiers'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end

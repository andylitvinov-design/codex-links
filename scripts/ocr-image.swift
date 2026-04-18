import Foundation
import Vision
import ImageIO

enum OcrError: Error {
  case missingPath
  case unreadableImage
}

let arguments = CommandLine.arguments

guard arguments.count > 1 else {
  throw OcrError.missingPath
}

let imageUrl = URL(fileURLWithPath: arguments[1])

guard
  let source = CGImageSourceCreateWithURL(imageUrl as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
  throw OcrError.unreadableImage
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["ru-RU", "en-US"]

let handler = VNImageRequestHandler(cgImage: image, options: [:])
try handler.perform([request])

let text = (request.results ?? [])
  .compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines) }
  .filter { !$0.isEmpty }
  .joined(separator: "\n")

print(text)

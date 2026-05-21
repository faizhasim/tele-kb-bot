class TeleKbBot < Formula
  desc "Telegram knowledge base bot powered by the pi coding agent SDK"
  homepage "https://github.com/faizhasim/tele-kb-bot"
  version "0.1.0"

  if Hardware::CPU.arm?
    url "https://github.com/faizhasim/tele-kb-bot/releases/download/v#{version}/tele-kb-bot-darwin-arm64.tar.gz"
    sha256 "REPLACE_WITH_ACTUAL_SHA256"
  else
    url "https://github.com/faizhasim/tele-kb-bot/releases/download/v#{version}/tele-kb-bot-darwin-x64.tar.gz"
    sha256 "REPLACE_WITH_ACTUAL_SHA256"
  end

  def install
    bin.install "tele-kb-bot"
  end

  test do
    assert_match "tele-kb-bot", shell_output("#{bin}/tele-kb-bot version")
  end
end

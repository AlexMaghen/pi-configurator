"""`python -m pi_configurator` is the same as the `pi-configurator` command."""

import sys

from .cli import main

sys.exit(main())
